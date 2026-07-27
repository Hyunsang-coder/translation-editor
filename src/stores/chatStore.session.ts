/**
 * chatStore 세션/메시지 CRUD + hydration 슬라이스
 */
import { v4 as uuidv4 } from 'uuid';
import type { ChatSession, ChatMessage, ChatSessionMemory } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { isTauriRuntime } from '@/tauri/invoke';
import { loadChatSessions, loadChatProjectSettings } from '@/tauri/chat';
import { listAttachments } from '@/tauri/attachments';
import {
  MAX_CHAT_SESSIONS,
  MAX_MESSAGES_PER_SESSION,
  CHAT_LENGTH_THRESHOLD,
} from './chatStore.types';
import type { ChatSet, ChatGet, ChatStore } from './chatStore.types';
import { mergePersonaIntoRules } from './chatStore.helpers';
import {
  getHydrateRequestId,
  incrementHydrateRequestId,
  clearPersistTimer,
} from './chatStore.persist';

// ── Session Actions ────────────────────────────────────────────────────

/**
 * 새 세션/마이그레이션 세션의 기본 모델 프리셋.
 * 전역 aiConfigStore.chatModel은 "새 세션 기본값"으로만 사용된다(세션별 선택과 분리).
 */
function getDefaultModelPreset(): string {
  return useAiConfigStore.getState().chatModel;
}

export function createSessionActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void; persistNow: () => Promise<void> },
) {
  const { schedulePersist, persistNow } = helpers;

  const runHydrateForProject = async (projectId: string | null): Promise<void> => {
    // 프로젝트 전환 시, 저장되지 않은 변경사항이 있으면 즉시 저장 (Flush)
    // 1. 현재와 같은 프로젝트면 진행 중 여부와 무관하게 중복 요청을 무시한다.
    // requestId도 증가시키지 않아 이미 진행 중인 정상 응답을 stale로 폐기하지 않는다.
    const currentLoadedId = get().loadedProjectId;
    if (projectId === currentLoadedId && projectId !== null) {
      return;
    }
    const requestId = incrementHydrateRequestId();

    console.warn(`[chatStore] hydrateForProject starting for: ${projectId} (current: ${currentLoadedId})`);

    // Issue #3 수정: 프로젝트 전환 시 진행 중인 API 요청 취소
    const prevAbortController = get().abortController;
    if (prevAbortController) {
      prevAbortController.abort();
      set({ abortController: null });
    }

    // 2. 프로젝트 전환 시, 저장되지 않은 변경사항이 있으면 즉시 저장 (Flush)
    clearPersistTimer();
    // persistNow는 await 전에 현재 설정 스냅샷을 만든다. 저장 Promise를 먼저
    // 시작한 뒤 UI 상태를 즉시 전환해, 느린 DB 저장 중에 이전 컨텍스트가
    // 새 프로젝트에 노출되는 공백을 없앤다.
    const pendingPersist = currentLoadedId && !get().isHydrating
      ? persistNow()
      : null;
    const awaitPendingPersist = async (): Promise<void> => {
      if (!pendingPersist) return;
      try {
        await pendingPersist;
      } catch (e) {
        // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[chatStore] persistNow failed during project switch:', message);
      }
    };

    // 프로젝트 전환 시, 기존 채팅 상태를 프로젝트 스코프로 재구성
    if (!projectId) {
      useProjectMemoryStore.getState().reset();
      set({
        sessions: [],
        currentSessionId: null,
        currentSession: null,
        lastInjectedGlossary: [],
        summarySuggestionDismissedBySessionId: {},
        isHydrating: false,
        isFinalizingStreaming: false,
        loadedProjectId: null,
        composerText: '',
        composerSelection: null,
        activeSelectionScopeIdBySession: {},
        composerFocusNonce: 0,
        pendingComposerFocus: null,
        pendingComposerAppend: null,
        translationRules: '',
        projectContext: '',
        webSearchEnabled: true,
        translationContextSessionId: null,
        composerAttachments: [],
        attachments: [],
        streamingMessageId: null,
        streamingSessionId: null,
        streamingContent: null,
        streamingMetadata: null,
        isLoading: false,
        isAttachmentLoading: false,
      });
      await awaitPendingPersist();
      return;
    }

    set({
      sessions: [],
      currentSessionId: null,
      currentSession: null,
      composerText: '',
      composerSelection: null,
      activeSelectionScopeIdBySession: {},
      translationRules: '',
      projectContext: '',
      webSearchEnabled: true,
      translationContextSessionId: null,
      attachments: [],
      composerAttachments: [],
      loadedProjectId: null,
      lastInjectedGlossary: [],
      summarySuggestionDismissedBySessionId: {},
      composerFocusNonce: 0,
      pendingComposerFocus: null,
      pendingComposerAppend: null,
      streamingMessageId: null,
      streamingSessionId: null,
      streamingContent: null,
      streamingMetadata: null,
      isLoading: false,
      isAttachmentLoading: false,
      isHydrating: true,
      isFinalizingStreaming: false,
      error: null,
    });
    await awaitPendingPersist();

    try {
      if (!isTauriRuntime()) {
        set({ isHydrating: false });
        return;
      }

      const [sessionsRes, settingsRes, attachmentsRes] = await Promise.all([
        loadChatSessions(projectId),
        loadChatProjectSettings(projectId),
        listAttachments(projectId),
      ]);

      const atts = attachmentsRes ?? [];

      // Issue #3 수정: 프로젝트 ID 재검증 강화
      // 비동기 로드 중 프로젝트가 전환되었으면 이 결과를 무시
      const activeProjectId = useProjectStore.getState().project?.id ?? null;
      if (requestId !== getHydrateRequestId()) {
        console.warn(`[chatStore] hydrateForProject aborted: newer request exists (current: ${getHydrateRequestId()}, this: ${requestId})`);
        return;
      }
      if (activeProjectId !== projectId) {
        console.warn(`[chatStore] hydrateForProject aborted: project changed during load (expected: ${projectId}, active: ${activeProjectId})`);
        set({ isHydrating: false });
        return;
      }

      // Migration: confluenceSearchEnabled 기본값 true, modelPreset 없으면 전역 기본값 상속
      const defaultPreset = getDefaultModelPreset();
      const migratedSessions = (sessionsRes ?? []).slice(0, MAX_CHAT_SESSIONS).map((session) => ({
        ...session,
        messages: session.messages.map((message) => {
          const selection = message.metadata?.selection;
          if (!selection) return message;
          return {
            ...message,
            metadata: {
              ...message.metadata,
              selection: {
                ...selection,
                anchorStatusAtSend: 'detached' as const,
              },
            },
          };
        }),
        confluenceSearchEnabled: session.confluenceSearchEnabled ?? true,
        modelPreset: session.modelPreset ?? defaultPreset,
      }));

      const nextState: Partial<ChatStore> = {
        isHydrating: false,
        loadedProjectId: projectId, // 로드 성공 후에만 ID 설정 (저장 허용)
        sessions: migratedSessions,
        currentSessionId: migratedSessions.length > 0 ? migratedSessions[0]!.id : null,
        currentSession: migratedSessions.length > 0 ? migratedSessions[0]! : null,
        attachments: atts,
        composerAttachments: [],
      };

      if (settingsRes) {
        // Migration: systemPromptOverlay / translatorPersona → translationRules
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const legacyOverlay = (settingsRes as { systemPromptOverlay?: string }).systemPromptOverlay;
        const legacyPersona = (settingsRes.translatorPersona ?? legacyOverlay ?? '').trim();
        const migratedRules = mergePersonaIntoRules(
          legacyPersona,
          settingsRes.translationRules ?? '',
        );

        nextState.translationRules = migratedRules;
        nextState.projectContext = settingsRes.projectContext ?? '';
        nextState.composerText = settingsRes.composerText ?? '';
        nextState.webSearchEnabled = settingsRes.webSearchEnabled ?? false;
        nextState.translationContextSessionId = settingsRes.translationContextSessionId ?? null;
      } else {
        nextState.translationRules = '';
        nextState.projectContext = '';
        nextState.composerText = '';
        nextState.webSearchEnabled = true;
        nextState.translationContextSessionId = null;
      }

      set(nextState);

      // 구조화 Project Memory/금칙어는 chat settings와 별도 테이블에 있지만
      // 같은 프로젝트 전환 경계에서 hydrate한다. store 자체의 request sequence가
      // 늦게 끝난 이전 프로젝트 응답을 폐기한다.
      try {
        await useProjectMemoryStore.getState().hydrate(
          projectId,
          nextState.projectContext ?? '',
        );
      } catch (memoryError) {
        console.warn(
          '[chatStore] project memory hydration failed:',
          memoryError instanceof Error ? memoryError.message : String(memoryError),
        );
      }

      // 레거시 persona가 rules로 흡수됐으면 다음 persist에서 DB 필드도 비워지도록 예약
      if (settingsRes?.translatorPersona?.trim() || (settingsRes as { systemPromptOverlay?: string } | null)?.systemPromptOverlay?.trim()) {
        schedulePersist();
      }

      // uiStore 동기화: 실제 세션 ID로 chat 패널 갱신
      const sessionIds = migratedSessions.map((s) => s.id);
      useUIStore.getState().syncChatPanels(sessionIds);
    } catch (e) {
      if (requestId !== getHydrateRequestId()) {
        return;
      }
      set({
        isHydrating: false,
        error: e instanceof Error ? e.message : '채팅 상태 로드 실패',
      });
    }
  };

  let inFlightHydration: { projectId: string | null; promise: Promise<void> } | null = null;

  /**
   * 같은 프로젝트에 대한 동시 요청을 하나로 합친다.
   *
   * 기동 시 `projectStore.initializeProject`와 좌·우 `ChatContent`가 각각 호출하는데,
   * 하이드레이션 중에는 `loadedProjectId`가 null이라 위 함수 초입의 중복 가드를 모두
   * 통과한다. 세대 가드가 나중 요청만 살리므로 결과는 정확했지만, chat settings와
   * project memory를 세 번 읽고 두 번 버리고 있었다.
   */
  const hydrateForProject = (projectId: string | null): Promise<void> => {
    const inFlight = inFlightHydration;
    if (inFlight && inFlight.projectId === projectId) return inFlight.promise;

    const entry: { projectId: string | null; promise: Promise<void> } = {
      projectId,
      promise: Promise.resolve(),
    };
    entry.promise = runHydrateForProject(projectId).finally(() => {
      if (inFlightHydration === entry) inFlightHydration = null;
    });
    inFlightHydration = entry;
    return entry.promise;
  };

  const createSession = (name?: string): string => {
    // 최대 5개 제한: 초과 생성은 조용히 무시
    const existing = get().sessions;
    if (existing.length >= MAX_CHAT_SESSIONS) {
      // 현재 세션이 null이면 첫 번째 세션으로 전환
      const { currentSessionId, currentSession } = get();
      if (currentSessionId && currentSession) {
        return currentSessionId;
      }
      // currentSession이 null인 경우 첫 번째 세션으로 전환
      const firstSession = existing[0];
      if (firstSession) {
        set({ currentSessionId: firstSession.id, currentSession: firstSession });
        return firstSession.id;
      }
      return '';
    }

    const sessionId = uuidv4();
    const now = Date.now();

    const newSession: ChatSession = {
      id: sessionId,
      name: name ?? `Chat ${get().sessions.length + 1}`,
      createdAt: now,
      messages: [],
      contextBlockIds: [],
      confluenceSearchEnabled: true,
      // 새 세션은 전역 기본 모델을 상속(이후 세션별로 독립 변경 가능)
      modelPreset: getDefaultModelPreset(),
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      currentSessionId: sessionId,
      currentSession: newSession,
    }));

    // uiStore 동기화: 새 채팅 패널 추가
    useUIStore.getState().addChatPanel(sessionId);

    schedulePersist();

    return sessionId;
  };

  const switchSession = (sessionId: string): void => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session) {
      set({ currentSessionId: sessionId, currentSession: session });
      schedulePersist();
    }
  };

  const deleteSession = (sessionId: string): void => {
    const { sessions, currentSessionId } = get();
    const newSessions = sessions.filter((s) => s.id !== sessionId);

    let newCurrentSessionId = currentSessionId;
    let newCurrentSession = get().currentSession;

    if (currentSessionId === sessionId) {
      const firstSession = newSessions[0];
      newCurrentSessionId = firstSession?.id ?? null;
      newCurrentSession = firstSession ?? null;
    }

    set((state) => {
      const nextDismissMap = { ...state.summarySuggestionDismissedBySessionId };
      delete nextDismissMap[sessionId];
      return {
        sessions: newSessions,
        currentSessionId: newCurrentSessionId,
        currentSession: newCurrentSession,
        summarySuggestionDismissedBySessionId: nextDismissMap,
      };
    });

    // uiStore 동기화: 채팅 패널 제거
    useUIStore.getState().removeChatPanel(sessionId);

    schedulePersist();
  };

  const renameSession = (sessionId: string, name: string): void => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, name } : s
      ),
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, name }
          : state.currentSession,
    }));
    schedulePersist();
  };

  /**
   * 세션별 모델 프리셋을 변경한다(세션 범위, 전역 chatModel과 분리).
   * - idle 세션에서 호출 시 다음 응답부터 적용된다(진행 중 요청은 캡처된 runConfig를 유지).
   * - 전역 aiConfigStore.chatModel은 건드리지 않는다(새 세션 기본값 보존).
   */
  const setSessionModelPreset = (sessionId: string, preset: string): void => {
    const target = get().sessions.find((s) => s.id === sessionId);
    if (!target || target.modelPreset === preset) return;
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, modelPreset: preset } : s
      ),
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, modelPreset: preset }
          : state.currentSession,
    }));
    schedulePersist();
  };

  /**
   * 세션의 장기 대화 요약(memory)을 갱신한다 (Phase 3).
   * - transcript(messages)는 건드리지 않는다. working context 요약만 저장/영속한다.
   */
  const updateSessionMemory = (sessionId: string, memory: ChatSessionMemory): void => {
    const target = get().sessions.find((s) => s.id === sessionId);
    if (!target) return;
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, memory } : s
      ),
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, memory }
          : state.currentSession,
    }));
    schedulePersist();
  };

  const shouldShowSummarySuggestion = (): boolean => {
    const session = get().currentSession;
    if (!session) return false;
    if (get().summarySuggestionDismissedBySessionId[session.id]) return false;
    return session.messages.length >= CHAT_LENGTH_THRESHOLD;
  };

  const dismissSummarySuggestion = (targetSessionId?: string): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session) return;
    set((state) => ({
      summarySuggestionDismissedBySessionId: {
        ...state.summarySuggestionDismissedBySessionId,
        [session.id]: true,
      },
    }));
  };

  const startNewSessionFromSuggestion = (targetSessionId?: string): void => {
    // 현재 세션 dismiss 후 새 세션 생성
    get().dismissSummarySuggestion(targetSessionId);
    get().createSession();
  };

  const isSessionLimitReached = (): boolean => {
    return get().sessions.length >= MAX_CHAT_SESSIONS;
  };

  const getOldestSession = (): ChatSession | null => {
    const sessions = get().sessions;
    if (sessions.length === 0) return null;
    return sessions.reduce((oldest, s) => (s.createdAt < oldest.createdAt ? s : oldest), sessions[0]!);
  };

  return {
    hydrateForProject,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    setSessionModelPreset,
    updateSessionMemory,
    shouldShowSummarySuggestion,
    dismissSummarySuggestion,
    startNewSessionFromSuggestion,
    isSessionLimitReached,
    getOldestSession,
  };
}

// ── Message Actions ────────────────────────────────────────────────────

export function createMessageActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void },
) {
  const { schedulePersist } = helpers;

  const addMessage = (message: Omit<ChatMessage, 'id' | 'timestamp'>, targetSessionId?: string): string | null => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session || !resolvedSessionId) return null;

    const { metadata, ...rest } = message;
    const newMessage: ChatMessage = {
      ...rest,
      ...(metadata ? { metadata } : {}),
      id: uuidv4(),
      timestamp: Date.now(),
    } as ChatMessage;

    // 메시지 제한 초과 시 오래된 메시지 삭제
    let existingMessages = session.messages;
    if (existingMessages.length >= MAX_MESSAGES_PER_SESSION) {
      // 오래된 메시지 1개 삭제 (FIFO)
      existingMessages = existingMessages.slice(1);
    }

    const updatedSession: ChatSession = {
      ...session,
      messages: [...existingMessages, newMessage],
    };

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === resolvedSessionId ? updatedSession : s
      ),
      ...(resolvedSessionId === state.currentSessionId
        ? { currentSession: updatedSession }
        : {}),
    }));
    schedulePersist();
    return newMessage.id;
  };

  const updateMessage = (
    messageId: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
    targetSessionId?: string,
  ): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session || !resolvedSessionId) return;

    const updatedMessages = session.messages.map((m) => {
      if (m.id !== messageId) return m;
      const { metadata, ...rest } = patch;
      return {
        ...m,
        ...rest,
        ...(metadata ? { metadata: { ...m.metadata, ...metadata } } : {}),
      };
    });

    const updatedSession: ChatSession = { ...session, messages: updatedMessages };

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === resolvedSessionId ? updatedSession : s
      ),
      ...(resolvedSessionId === state.currentSessionId
        ? { currentSession: updatedSession }
        : {}),
    }));
    schedulePersist();
  };

  const editMessage = (messageId: string, nextContent: string, targetSessionId?: string): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session || !resolvedSessionId) return;

    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const target = session.messages[idx];
    if (!target) return;

    const trimmed = nextContent.trim();
    if (!trimmed) return;

    const updatedMessages = session.messages.slice(0, idx + 1).map((m) => {
      if (m.id !== messageId) return m;
      return {
        ...m,
        content: trimmed,
        metadata: {
          ...m.metadata,
          ...(m.metadata?.originalContent ? {} : { originalContent: m.content }),
          editedAt: Date.now(),
        },
      };
    });

    const updatedSession: ChatSession = { ...session, messages: updatedMessages };
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === resolvedSessionId ? updatedSession : s)),
      streamingMessageId: null,
      streamingSessionId: null,
      isLoading: false,
      ...(resolvedSessionId === state.currentSessionId
        ? { currentSession: updatedSession }
        : {}),
    }));
    schedulePersist();
  };

  const deleteMessageFrom = (messageId: string, targetSessionId?: string): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session || !resolvedSessionId) return;

    // 진행 중인 API 요청 취소
    const abortController = get().abortController;
    if (abortController) {
      abortController.abort();
    }

    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const updatedMessages = session.messages.slice(0, idx);
    const updatedSession: ChatSession = { ...session, messages: updatedMessages };
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === resolvedSessionId ? updatedSession : s)),
      streamingMessageId: null,
      streamingSessionId: null,
      isLoading: false,
      abortController: null,
      ...(resolvedSessionId === state.currentSessionId
        ? { currentSession: updatedSession }
        : {}),
    }));
    schedulePersist();
  };

  const clearMessages = (targetSessionId?: string): void => {
    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session || !resolvedSessionId) return;

    const updatedSession: ChatSession = {
      ...session,
      messages: [],
    };

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === resolvedSessionId ? updatedSession : s
      ),
      ...(resolvedSessionId === state.currentSessionId
        ? { currentSession: updatedSession }
        : {}),
    }));
    schedulePersist();
  };

  return {
    addMessage,
    updateMessage,
    editMessage,
    deleteMessageFrom,
    clearMessages,
  };
}
