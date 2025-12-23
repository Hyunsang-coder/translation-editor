import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ChatSession, ChatMessage, EditorBlock, GlossaryEntry } from '@/types';
import { streamAssistantReply } from '@/ai/chat';
import { getAiConfig } from '@/ai/config';
import { detectRequestType } from '@/ai/prompt';
import { useProjectStore } from '@/stores/projectStore';
import { searchGlossary } from '@/tauri/glossary';
import { isTauriRuntime } from '@/tauri/invoke';
import {
  loadChatProjectSettings,
  loadCurrentChatSession,
  saveChatProjectSettings,
  saveCurrentChatSession,
  type ChatProjectSettings,
} from '@/tauri/chat';
import {
  createGhostMaskSession,
  maskGhostChips,
  restoreGhostChips,
} from '@/utils/ghostMask';
import { stripHtml } from '@/utils/hash';
import { buildTargetDocument } from '@/editor/targetDocument';

const CHAT_PERSIST_DEBOUNCE_MS = 800;
let chatPersistTimer: number | null = null;
let chatPersistInFlight = false;
let chatPersistQueued = false;

const DEFAULT_SYSTEM_PROMPT_OVERLAY =
  '당신은 경험많은 전문 번역가입니다. 원문의 내용을 {언어}로 자연스럽게 번역하세요.';

// ============================================
// Store State Interface
// ============================================

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSession: ChatSession | null;
  isLoading: boolean;
  isHydrating: boolean;
  streamingMessageId: string | null;
  error: string | null;
  // 최근 요청에서 주입된 글로서리(디버깅/가시화)
  lastInjectedGlossary: GlossaryEntry[];
  // Smart Context Memory (4.3)
  isSummarizing: boolean;
  summarySuggestionOpen: boolean;
  summarySuggestionReason: string;
  lastSummaryAtMessageCountBySessionId: Record<string, number>;
  // Chat composer
  composerText: string;
  composerFocusNonce: number;
  systemPromptOverlay: string;
  translationRules: string;
  activeMemory: string;
  includeSourceInPayload: boolean;
  includeTargetInPayload: boolean;
  /**
   * 문서 전체 번역(Preview→Apply) 컨텍스트로 사용할 채팅 탭
   * - null이면 현재 탭(currentSession)의 최신 메시지 10개를 사용
   */
  translationContextSessionId: string | null;
}

interface ChatActions {
  // 세션 관리
  createSession: (name?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;

  // 메시지 관리
  sendMessage: (content: string) => Promise<void>;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string | null;
  updateMessage: (
    messageId: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
  ) => void;
  /**
   * 메시지 수정: 해당 메시지 이후 대화는 truncate됩니다.
   */
  editMessage: (messageId: string, nextContent: string) => void;
  /**
   * 메시지 수정 후 같은 내용으로 다시 호출
   */
  replayMessage: (messageId: string) => Promise<void>;
  /**
   * 메시지 삭제: 해당 메시지(포함) 이후 대화는 truncate됩니다.
   */
  deleteMessageFrom: (messageId: string) => void;
  clearMessages: () => void;

  // Composer
  setComposerText: (text: string) => void;
  appendComposerText: (text: string, opts?: { separator?: string }) => void;
  requestComposerFocus: () => void;

  // 컨텍스트 블록 관리
  setContextBlocks: (blockIds: string[]) => void;
  addContextBlock: (blockId: string) => void;
  removeContextBlock: (blockId: string) => void;

  // Smart Context Memory (4.3)
  checkAndSuggestActiveMemory: () => void;
  dismissSummarySuggestion: () => void;
  generateActiveMemorySummary: () => Promise<void>;

  // 유틸리티
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setSystemPromptOverlay: (overlay: string) => void;
  setTranslationRules: (rules: string) => void;
  appendToTranslationRules: (snippet: string) => void;
  setActiveMemory: (memory: string) => void;
  appendToActiveMemory: (snippet: string) => void;
  setIncludeSourceInPayload: (val: boolean) => void;
  setIncludeTargetInPayload: (val: boolean) => void;
  setTranslationContextSessionId: (sessionId: string | null) => void;

  // Persistence (project-scoped)
  hydrateForProject: (projectId: string | null) => Promise<void>;

  // AI Interaction Feedback
}

type ChatStore = ChatState & ChatActions;

// ============================================
// Store Implementation
// ============================================

export const useChatStore = create<ChatStore>((set, get) => {
  const getActiveProjectId = (): string | null =>
    useProjectStore.getState().project?.id ?? null;

  const buildChatSettings = (): ChatProjectSettings => ({
    systemPromptOverlay: get().systemPromptOverlay,
    translationRules: get().translationRules,
    activeMemory: get().activeMemory,
    composerText: get().composerText,
    includeSourceInPayload: get().includeSourceInPayload,
    includeTargetInPayload: get().includeTargetInPayload,
    translationContextSessionId: get().translationContextSessionId,
  });

  const persistNow = async (): Promise<void> => {
    if (!isTauriRuntime()) return;
    if (get().isHydrating) return; // 로드 중에는 저장하지 않음 (데이터 유실 방지)
    const projectId = getActiveProjectId();
    if (!projectId) return;

    const session = get().currentSession;
    const settings = buildChatSettings();

    // 세션은 1개만 저장(요구사항)
    if (session) {
      await saveCurrentChatSession({ projectId, session });
    }
    await saveChatProjectSettings({ projectId, settings });
  };

  const schedulePersist = (): void => {
    if (!isTauriRuntime()) return;
    if (chatPersistTimer !== null) {
      window.clearTimeout(chatPersistTimer);
      chatPersistTimer = null;
    }
    chatPersistTimer = window.setTimeout(() => {
      if (chatPersistInFlight) {
        chatPersistQueued = true;
        return;
      }
      chatPersistInFlight = true;
      void persistNow()
        .catch(() => {
          // chat persistence는 UX 방해 최소화: 실패는 조용히 처리
        })
        .finally(() => {
          chatPersistInFlight = false;
          if (chatPersistQueued) {
            chatPersistQueued = false;
            schedulePersist();
          }
        });
    }, CHAT_PERSIST_DEBOUNCE_MS);
  };

  const resolveTargetDocumentText = (
    includeTarget: boolean,
    project: Parameters<typeof buildTargetDocument>[0] | null,
  ): string | undefined => {
    if (!includeTarget) return undefined;

    const raw = useProjectStore.getState().targetDocument;
    const fromStore = raw ? stripHtml(raw) : '';
    if (fromStore.trim().length > 0) return fromStore;

    if (project) {
      const built = buildTargetDocument(project);
      if (built?.text?.trim().length > 0) return built.text;
    }

    return undefined;
  };

  const resolveSourceDocumentText = (): string | undefined => {
    const raw = useProjectStore.getState().sourceDocument;
    if (raw?.trim().length > 0) return stripHtml(raw);
    return undefined;
  };

  return {
    // Initial State
    sessions: [],
    currentSessionId: null,
    currentSession: null,
    isLoading: false,
    streamingMessageId: null,
    error: null,
    lastInjectedGlossary: [],
    isSummarizing: false,
    isHydrating: false,
    summarySuggestionOpen: false,
    summarySuggestionReason: '',
    lastSummaryAtMessageCountBySessionId: {},
    composerText: '',
    composerFocusNonce: 0,
    systemPromptOverlay: DEFAULT_SYSTEM_PROMPT_OVERLAY,
    translationRules: '',
    activeMemory: '한국어로 번역시 자주 사용되는 영어 단어는 음차한다.',
    includeSourceInPayload: true,
    includeTargetInPayload: true,
    translationContextSessionId: null,

    hydrateForProject: async (projectId: string | null): Promise<void> => {
      // 프로젝트 전환 시, 기존 채팅 상태를 프로젝트 스코프로 재구성
      if (!projectId) {
        set({
          sessions: [],
          currentSessionId: null,
          currentSession: null,
          isHydrating: false,
        });
        return;
      }

      set({ isHydrating: true, error: null });

      try {
        if (!isTauriRuntime()) {
          set({ isHydrating: false });
          return;
        }

        const [session, settings] = await Promise.all([
          loadCurrentChatSession(projectId),
          loadChatProjectSettings(projectId),
        ]);

        const nextState: Partial<ChatStore> = {
          isHydrating: false,
          sessions: session ? [session] : [],
          currentSessionId: session?.id ?? null,
          currentSession: session ?? null,
          lastSummaryAtMessageCountBySessionId: session ? { [session.id]: 0 } : {},
        };

        if (settings) {
          nextState.systemPromptOverlay = settings.systemPromptOverlay?.trim()
            ? settings.systemPromptOverlay
            : DEFAULT_SYSTEM_PROMPT_OVERLAY;
          nextState.translationRules = settings.translationRules;
          nextState.activeMemory = settings.activeMemory;
          nextState.composerText = settings.composerText ?? '';
          nextState.includeSourceInPayload = settings.includeSourceInPayload;
          nextState.includeTargetInPayload = settings.includeTargetInPayload;
          nextState.translationContextSessionId = settings.translationContextSessionId ?? null;
        } else {
          // 설정이 없으면 기본값 유지
          nextState.systemPromptOverlay = DEFAULT_SYSTEM_PROMPT_OVERLAY;
          nextState.translationRules = '';
          nextState.activeMemory = '';
          nextState.composerText = '';
          nextState.includeSourceInPayload = true;
          nextState.includeTargetInPayload = true;
          nextState.translationContextSessionId = null;
        }

        set(nextState);
      } catch (e) {
        set({
          isHydrating: false,
          error: e instanceof Error ? e.message : '채팅 상태 로드 실패',
        });
      }
    },

    // 세션 생성
    createSession: (name?: string): string => {
      const sessionId = uuidv4();
      const now = Date.now();

      const newSession: ChatSession = {
        id: sessionId,
        name: name ?? `Chat ${get().sessions.length + 1}`,
        createdAt: now,
        messages: [],
        contextBlockIds: [],
      };

      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSessionId: sessionId,
        currentSession: newSession,
        lastSummaryAtMessageCountBySessionId: {
          ...state.lastSummaryAtMessageCountBySessionId,
          [sessionId]: 0,
        },
      }));

      schedulePersist();

      return sessionId;
    },

    // 세션 전환
    switchSession: (sessionId: string): void => {
      const session = get().sessions.find((s) => s.id === sessionId);
      if (session) {
        set({ currentSessionId: sessionId, currentSession: session });
        schedulePersist();
      }
    },

    // 세션 삭제
    deleteSession: (sessionId: string): void => {
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
        const nextMap = { ...state.lastSummaryAtMessageCountBySessionId };
        delete nextMap[sessionId];
        return {
          sessions: newSessions,
          currentSessionId: newCurrentSessionId,
          currentSession: newCurrentSession,
          lastSummaryAtMessageCountBySessionId: nextMap,
        };
      });

      schedulePersist();
    },

    // 세션 이름 변경
    renameSession: (sessionId: string, name: string): void => {
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
    },

    // 메시지 전송
    sendMessage: async (content: string): Promise<void> => {
      const { currentSession, createSession, addMessage, updateMessage } = get();

      // 세션이 없으면 생성
      if (!currentSession) {
        createSession();
      }

      // 채팅은 "질문 전용"으로 운영: 번역/리라이트 요청은 Translate(Preview) 워크플로우로 유도
      const req = detectRequestType(content);

      // request 단위 Ghost mask (무결성 보호)
      const maskSession = createGhostMaskSession();
      const maskedUserContent = maskGhostChips(content, maskSession);

      // 사용자 메시지 추가
      addMessage({ role: 'user', content });

      // [Auto-Title] 첫 메시지인 경우 세션 이름 자동 변경
      const updatedSession = get().currentSession;
      if (updatedSession && updatedSession.messages.length === 1) {
        // 간단한 규칙: 첫 20자 + ...
        const newTitle = content.trim().slice(0, 20) + (content.length > 20 ? '...' : '');
        get().renameSession(updatedSession.id, newTitle);
      }

      // 번역 요청은 모델 호출 없이 즉시 안내(번역 결과를 채팅으로 출력하지 않음)
      if (req === 'translate') {
        const translationRulesRaw = get().translationRules?.trim();
        const activeMemoryRaw = get().activeMemory?.trim();

        const needsOneQuestion = !translationRulesRaw && !activeMemoryRaw;
        const msg = needsOneQuestion
          ? [
              '이 요청은 채팅에서 번역하지 않습니다.',
              '원하는 톤/용어 규칙이 있나요? (있으면 Settings에 적어두고) Translate 버튼을 눌러주세요.',
            ].join(' ')
          : '이 요청은 채팅에서 번역하지 않습니다. Translate 버튼을 눌러 문서 전체 번역(Preview→Apply)으로 진행해주세요.';

        addMessage({ role: 'assistant', content: msg });
        set({ isLoading: false, streamingMessageId: null, error: null });
        schedulePersist();
        return;
      }

      set({ isLoading: true, error: null });

      try {
        const cfg = getAiConfig();
        const session = get().currentSession;
        const project = useProjectStore.getState().project;
        const currentSourceDocument = resolveSourceDocumentText();
        const systemPromptOverlay = get().systemPromptOverlay;

        const contextBlockIds = session?.contextBlockIds ?? [];
        const contextBlocks =
          project
            ? contextBlockIds
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
            : [];
        const fallbackSourceText =
          contextBlocks.length === 0 && currentSourceDocument ? currentSourceDocument : undefined;
        const translationRulesRaw = get().translationRules;
        const activeMemoryRaw = get().activeMemory;
        const includeSource = get().includeSourceInPayload;
        const includeTarget = get().includeTargetInPayload;
        const sourceDocumentRaw = includeSource ? currentSourceDocument : undefined;
        const targetDocumentRaw = resolveTargetDocumentText(includeTarget, project);

        const translationRules = translationRulesRaw
          ? maskGhostChips(translationRulesRaw, maskSession)
          : '';
        const activeMemory = activeMemoryRaw ? maskGhostChips(activeMemoryRaw, maskSession) : '';
        // TipTap의 Source/Target은 HTML로 저장되므로, 채팅 컨텍스트에는 plain text를 우선 포함합니다.
        const sourceDocument = sourceDocumentRaw
          ? maskGhostChips(sourceDocumentRaw, maskSession)
          : undefined;
        const targetDocument = targetDocumentRaw
          ? maskGhostChips(targetDocumentRaw, maskSession)
          : undefined;

        // 로컬 글로서리 주입(on-demand: 모델 호출 시에만)
        let glossaryInjected = '';
        try {
          if (project?.id) {
            const plainContext = contextBlocks
              .map((b) => stripHtml(b.content))
              .join('\n')
              .slice(0, 1200);
            const q = [content, plainContext].filter(Boolean).join('\n').slice(0, 2000);
            const hits = q.trim().length
              ? await searchGlossary({
                projectId: project.id,
                query: q,
                domain: project.metadata.domain,
                limit: 12,
              })
              : [];
            set({ lastInjectedGlossary: hits });
            if (hits.length > 0) {
              const raw = hits
                .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
                .join('\n');
              glossaryInjected = maskGhostChips(raw, maskSession);
            }
          } else {
            set({ lastInjectedGlossary: [] });
          }
        } catch {
          // 글로서리 검색 실패는 조용히 무시(모델 호출 UX 방해 최소화)
          set({ lastInjectedGlossary: [] });
        }

        // 사용자 요청: 모델 호출 시 채팅 히스토리(이전 메시지)는 컨텍스트에 포함하지 않음
        const recent: ChatMessage[] = [];

        const assistantId = addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: cfg.model },
        });
        if (assistantId) {
          set({ streamingMessageId: assistantId });
        }

        const replyMasked = await streamAssistantReply(
          {
            project,
            contextBlocks,
            recentMessages: recent,
            userMessage: maskedUserContent,
            systemPromptOverlay,
            translationRules,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            ...(fallbackSourceText ? { fallbackSourceText } : {}),
            activeMemory,
            ...(sourceDocument ? { sourceDocument } : {}),
            ...(targetDocument ? { targetDocument } : {}),
            // 채팅은 항상 "question"으로 호출 (자동 번역 모드 진입 방지)
            requestType: 'question',
          },
          {
            onToken: (full) => {
              if (assistantId) {
                updateMessage(assistantId, { content: restoreGhostChips(full, maskSession) });
              }
            },
          },
        );

        if (assistantId) {
          updateMessage(assistantId, { content: restoreGhostChips(replyMasked, maskSession) });
        }

        restoreGhostChips(replyMasked, maskSession);
        set({ isLoading: false, streamingMessageId: null });
        get().checkAndSuggestActiveMemory();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'AI 응답 생성 실패',
          isLoading: false,
          streamingMessageId: null,
        });
      }
    },

    setComposerText: (text: string): void => {
      set({ composerText: text });
      schedulePersist();
    },

    appendComposerText: (text: string, opts?: { separator?: string }): void => {
      const incoming = text.trim();
      if (!incoming) return;
      const sep = opts?.separator ?? '\n\n';
      set((state) => {
        const next = state.composerText.trim().length > 0 ? `${state.composerText}${sep}${incoming}` : incoming;
        return {
          composerText: next,
          composerFocusNonce: state.composerFocusNonce + 1,
        };
      });
      schedulePersist();
    },

    requestComposerFocus: (): void => {
      set((state) => ({ composerFocusNonce: state.composerFocusNonce + 1 }));
    },

    checkAndSuggestActiveMemory: (): void => {
      const session = get().currentSession;
      if (!session) return;

      // “자동 생성”은 금지(Non-Intrusive AI) → 임계치 도달 시 ‘제안’만 띄움
      // token은 정확히 계산하지 않고, 문자 길이 기반으로 근사합니다.
      const msgCount = session.messages.length;
      const lastCount = get().lastSummaryAtMessageCountBySessionId[session.id] ?? 0;
      const newMessagesSinceLast = msgCount - lastCount;
      if (newMessagesSinceLast < 12) return; // 너무 잦은 제안 방지

      const totalChars = session.messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
      const thresholdChars = 6000; // 대략 1.5k~2k tokens 근사

      if (totalChars < thresholdChars) return;

      if (!get().summarySuggestionOpen) {
        set({
          summarySuggestionOpen: true,
          summarySuggestionReason: '대화가 길어져서 용어/톤 규칙 요약(Active Memory)을 생성하면 컨텍스트 비용을 줄일 수 있어요.',
        });
      }
    },

    dismissSummarySuggestion: (): void => {
      set({ summarySuggestionOpen: false, summarySuggestionReason: '' });
    },

    generateActiveMemorySummary: async (): Promise<void> => {
      const session = get().currentSession;
      if (!session) return;
      if (get().isSummarizing) return;

      set({ isSummarizing: true, error: null });

      try {
        const cfg = getAiConfig();
        const project = useProjectStore.getState().project;
        const current = get().activeMemory.trim();

        // 최근 메시지만 요약(과도한 토큰 방지)
        const maxN = Math.max(20, cfg.maxRecentMessages);
        const history = session.messages.slice(Math.max(0, session.messages.length - maxN));

        const transcript = history
          .map((m) => {
            const role = m.role === 'assistant' ? 'AI' : m.role === 'user' ? 'USER' : 'SYSTEM';
            return `${role}: ${m.content}`;
          })
          .join('\n\n');

        const userMessage = [
          '너는 번역 프로젝트의 “Active Memory(용어/톤 규칙)”만 요약하는 에디터 보조 AI다.',
          '',
          '목표:',
          '- 아래 대화에서 확정된 “용어/스타일/포맷 규칙”만 추출해 짧게 요약한다.',
          '- 번역 내용 자체를 재작성/제안하지 않는다.',
          '',
          '출력 규칙:',
          '- 출력은 한국어로.',
          '- 최대 1200자.',
          '- 불릿/번호/따옴표/마크다운 금지. (그냥 줄바꿈으로 규칙만 나열)',
          '- 확정되지 않은 내용은 포함하지 않는다.',
          '',
          current ? `기존 Active Memory(있으면 갱신/정리):\n${current}\n` : '',
          '대화 기록:',
          transcript,
        ]
          .filter(Boolean)
          .join('\n');

        const reply = await streamAssistantReply({
          project,
          contextBlocks: [],
          recentMessages: [],
          userMessage,
          ...(current ? { activeMemory: current } : {}),
        });

        const cleaned = reply.trim().slice(0, 1200);
        set((state) => ({
          activeMemory: cleaned,
          lastSummaryAtMessageCountBySessionId: {
            ...state.lastSummaryAtMessageCountBySessionId,
            [session.id]: session.messages.length,
          },
          summarySuggestionOpen: false,
          summarySuggestionReason: '',
        }));
      } catch (e) {
        set({ error: e instanceof Error ? e.message : '요약 생성 실패' });
      } finally {
        set({ isSummarizing: false });
      }
    },

    // 메시지 추가
    addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>): string | null => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return null;

      const { metadata, ...rest } = message;
      const newMessage: ChatMessage = {
        ...rest,
        ...(metadata ? { metadata } : {}),
        id: uuidv4(),
        timestamp: Date.now(),
      } as ChatMessage;

      const updatedSession: ChatSession = {
        ...currentSession,
        messages: [...currentSession.messages, newMessage],
      };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
      return newMessage.id;
    },

    updateMessage: (
      messageId: string,
      patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
    ): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const updatedMessages = currentSession.messages.map((m) => {
        if (m.id !== messageId) return m;
        const { metadata, ...rest } = patch;
        return {
          ...m,
          ...rest,
          ...(metadata ? { metadata: { ...m.metadata, ...metadata } } : {}),
        };
      });

      const updatedSession: ChatSession = { ...currentSession, messages: updatedMessages };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
    },

    editMessage: (messageId: string, nextContent: string): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const idx = currentSession.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const target = currentSession.messages[idx];
      if (!target) return;

      const trimmed = nextContent.trim();
      if (!trimmed) return;

      const updatedMessages = currentSession.messages.slice(0, idx + 1).map((m) => {
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

      const updatedSession: ChatSession = { ...currentSession, messages: updatedMessages };
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === currentSessionId ? updatedSession : s)),
        currentSession: updatedSession,
        streamingMessageId: null,
        isLoading: false,
      }));
      schedulePersist();
    },

    replayMessage: async (messageId: string): Promise<void> => {
      const session = get().currentSession;
      if (!session) return;

      const targetMessage = session.messages.find((m) => m.id === messageId);
      if (!targetMessage || targetMessage.role !== 'user') return;

      const content = targetMessage.content?.trim();
      if (!content) return;

      const req = detectRequestType(content);

      // request 단위 Ghost mask (무결성 보호)
      const maskSession = createGhostMaskSession();
      const maskedUserContent = maskGhostChips(content, maskSession);

      // 번역 요청은 채팅에서 처리하지 않음 (기존 로직 재사용)
      if (req === 'translate') {
        const translationRulesRaw = get().translationRules?.trim();
        const activeMemoryRaw = get().activeMemory?.trim();
        const needsOneQuestion = !translationRulesRaw && !activeMemoryRaw;
        const msg = needsOneQuestion
          ? [
              '이 요청은 채팅에서 번역하지 않습니다.',
              '원하는 톤/용어 규칙이 있나요? (있으면 Settings에 적어두고) Translate 버튼을 눌러주세요.',
            ].join(' ')
          : '이 요청은 채팅에서 번역하지 않습니다. Translate 버튼을 눌러 문서 전체 번역(Preview→Apply)으로 진행해주세요.';

        const replyId = get().addMessage({ role: 'assistant', content: msg });
        if (replyId) {
          get().updateMessage(replyId, { metadata: { model: getAiConfig().model } });
        }
        set({ isLoading: false, streamingMessageId: null, error: null });
        schedulePersist();
        return;
      }

      set({ isLoading: true, error: null, streamingMessageId: null });

      try {
        const cfg = getAiConfig();
        const project = useProjectStore.getState().project;
        const currentSourceDocument = resolveSourceDocumentText();
        const systemPromptOverlay = get().systemPromptOverlay;

        const contextBlockIds = session.contextBlockIds ?? [];
        const contextBlocks =
          project
            ? contextBlockIds
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
            : [];
        const fallbackSourceText =
          contextBlocks.length === 0 && currentSourceDocument ? currentSourceDocument : undefined;
        const translationRulesRaw = get().translationRules;
        const activeMemoryRaw = get().activeMemory;
        const includeSource = get().includeSourceInPayload;
        const includeTarget = get().includeTargetInPayload;
        const sourceDocumentRaw = includeSource ? currentSourceDocument : undefined;
        const targetDocumentRaw = resolveTargetDocumentText(includeTarget, project);

        const translationRules = translationRulesRaw
          ? maskGhostChips(translationRulesRaw, maskSession)
          : '';
        const activeMemory = activeMemoryRaw ? maskGhostChips(activeMemoryRaw, maskSession) : '';
        const sourceDocument = sourceDocumentRaw
          ? maskGhostChips(sourceDocumentRaw, maskSession)
          : undefined;
        const targetDocument = targetDocumentRaw
          ? maskGhostChips(targetDocumentRaw, maskSession)
          : undefined;

        // 로컬 글로서리 주입(on-demand: 모델 호출 시에만)
        let glossaryInjected = '';
        try {
          if (project?.id) {
            const plainContext = contextBlocks
              .map((b) => stripHtml(b.content))
              .join('\n')
              .slice(0, 1200);
            const q = [content, plainContext].filter(Boolean).join('\n').slice(0, 2000);
            const hits = q.trim().length
              ? await searchGlossary({
                projectId: project.id,
                query: q,
                domain: project.metadata.domain,
                limit: 12,
              })
              : [];
            set({ lastInjectedGlossary: hits });
            if (hits.length > 0) {
              const raw = hits
                .map((e) => `- ${e.source} = ${e.target}${e.notes ? ` (${e.notes})` : ''}`)
                .join('\n');
              glossaryInjected = maskGhostChips(raw, maskSession);
            }
          } else {
            set({ lastInjectedGlossary: [] });
          }
        } catch {
          set({ lastInjectedGlossary: [] });
        }

        // 사용자 요청: 모델 호출 시 채팅 히스토리(이전 메시지)는 컨텍스트에 포함하지 않음
        const recent: ChatMessage[] = [];

        const assistantId = get().addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: cfg.model },
        });
        if (assistantId) {
          set({ streamingMessageId: assistantId });
        }

        const replyMasked = await streamAssistantReply(
          {
            project,
            contextBlocks,
            recentMessages: recent,
            userMessage: maskedUserContent,
            systemPromptOverlay,
            translationRules,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            ...(fallbackSourceText ? { fallbackSourceText } : {}),
            activeMemory,
            ...(sourceDocument ? { sourceDocument } : {}),
            ...(targetDocument ? { targetDocument } : {}),
            requestType: 'question',
          },
          {
            onToken: (full) => {
              if (assistantId) {
                get().updateMessage(assistantId, { content: restoreGhostChips(full, maskSession) });
              }
            },
          },
        );

        if (assistantId) {
          get().updateMessage(assistantId, { content: restoreGhostChips(replyMasked, maskSession) });
        }

        set({ isLoading: false, streamingMessageId: null });
        get().checkAndSuggestActiveMemory();
        schedulePersist();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'AI 응답 생성 실패',
          isLoading: false,
          streamingMessageId: null,
        });
      }
    },

    deleteMessageFrom: (messageId: string): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const idx = currentSession.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const updatedMessages = currentSession.messages.slice(0, idx);
      const updatedSession: ChatSession = { ...currentSession, messages: updatedMessages };
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === currentSessionId ? updatedSession : s)),
        currentSession: updatedSession,
        streamingMessageId: null,
        isLoading: false,
      }));
      schedulePersist();
    },

    // 메시지 초기화
    clearMessages: (): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const updatedSession: ChatSession = {
        ...currentSession,
        messages: [],
      };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
    },

    // 컨텍스트 블록 설정
    setContextBlocks: (blockIds: string[]): void => {
      const { currentSession, currentSessionId } = get();
      if (!currentSession || !currentSessionId) return;

      const updatedSession: ChatSession = {
        ...currentSession,
        contextBlockIds: blockIds,
      };

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId ? updatedSession : s
        ),
        currentSession: updatedSession,
      }));
      schedulePersist();
    },

    // 컨텍스트 블록 추가
    addContextBlock: (blockId: string): void => {
      const { currentSession } = get();
      if (!currentSession) return;

      if (!currentSession.contextBlockIds.includes(blockId)) {
        get().setContextBlocks([...currentSession.contextBlockIds, blockId]);
      }
    },

    // 컨텍스트 블록 제거
    removeContextBlock: (blockId: string): void => {
      const { currentSession } = get();
      if (!currentSession) return;

      get().setContextBlocks(
        currentSession.contextBlockIds.filter((id) => id !== blockId)
      );
    },

    // 로딩 상태 설정
    setLoading: (isLoading: boolean): void => {
      set({ isLoading });
    },

    // 에러 설정
    setError: (error: string | null): void => {
      set({ error });
    },

    setSystemPromptOverlay: (overlay: string): void => {
      set({ systemPromptOverlay: overlay });
      schedulePersist();
    },

    setTranslationRules: (rules: string): void => {
      set({ translationRules: rules });
      schedulePersist();
    },

    appendToTranslationRules: (snippet: string): void => {
      const incoming = snippet.trim();
      if (!incoming) return;
      const current = get().translationRules.trim();
      const next = current.length > 0 ? `${current}\n\n${incoming}` : incoming;
      set({ translationRules: next });
      schedulePersist();
    },

    setActiveMemory: (memory: string): void => {
      set({ activeMemory: memory });
      schedulePersist();
    },

    appendToActiveMemory: (snippet: string): void => {
      const incoming = snippet.trim();
      if (!incoming) return;
      const current = get().activeMemory.trim();
      const next = current.length > 0 ? `${current}\n\n${incoming}` : incoming;
      set({ activeMemory: next });
      schedulePersist();
    },

    setIncludeSourceInPayload: (val: boolean): void => {
      set({ includeSourceInPayload: val });
      schedulePersist();
    },

    setIncludeTargetInPayload: (val: boolean): void => {
      set({ includeTargetInPayload: val });
      schedulePersist();
    },

    setTranslationContextSessionId: (sessionId: string | null): void => {
      set({ translationContextSessionId: sessionId });
      schedulePersist();
    },
  };
});

