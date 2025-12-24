import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ChatSession, ChatMessage, GlossaryEntry } from '@/types';
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

const CHAT_PERSIST_DEBOUNCE_MS = 800;
let chatPersistTimer: number | null = null;
let chatPersistInFlight = false;
let chatPersistQueued = false;

const DEFAULT_TRANSLATOR_PERSONA = '';

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
  translatorPersona: string;
  translationRules: string;
  projectContext: string;
  /**
   * 문서 전체 번역(Preview→Apply) 컨텍스트로 사용할 채팅 탭
   * - null이면 현재 탭(currentSession)의 최신 메시지 10개를 사용
   */
  translationContextSessionId: string | null;
  /** 현재 로드된 프로젝트 ID (저장 시 검증용) */
  loadedProjectId: string | null;
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
  checkAndSuggestProjectContext: () => void;
  dismissSummarySuggestion: () => void;
  generateProjectContextSummary: () => Promise<void>;

  // 유틸리티
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setTranslatorPersona: (persona: string) => void;
  setTranslationRules: (rules: string) => void;
  appendToTranslationRules: (snippet: string) => void;
  setProjectContext: (memory: string) => void;
  appendToProjectContext: (snippet: string) => void;
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
  const buildChatSettings = (): ChatProjectSettings => ({
    translatorPersona: get().translatorPersona,
    translationRules: get().translationRules,
    projectContext: get().projectContext,
    composerText: get().composerText,
    translationContextSessionId: get().translationContextSessionId,
  });

  const persistNow = async (): Promise<void> => {
    if (!isTauriRuntime()) return;
    if (get().isHydrating) return; // 로드 중에는 저장하지 않음 (데이터 유실 방지)

    // getActiveProjectId() 대신 현재 스토어에 로드된 ID 사용
    const projectId = get().loadedProjectId;
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
    translatorPersona: DEFAULT_TRANSLATOR_PERSONA,
    translationRules: '',
    projectContext: '',
    translationContextSessionId: null,
    loadedProjectId: null,

    hydrateForProject: async (projectId: string | null): Promise<void> => {
      // 프로젝트 전환 시, 저장되지 않은 변경사항이 있으면 즉시 저장 (Flush)
      // 1. 현재와 같은 프로젝트고 이미 로드된 상태면 스킵 (불필요한 리로드 및 상태 초기화 방지)
      const currentLoadedId = get().loadedProjectId;
      if (projectId === currentLoadedId && !get().isHydrating && projectId !== null) {
        return;
      }

      console.log(`[chatStore] hydrateForProject starting for: ${projectId} (current: ${currentLoadedId})`);

      // 2. 프로젝트 전환 시, 저장되지 않은 변경사항이 있으면 즉시 저장 (Flush)
      if (chatPersistTimer !== null) {
        window.clearTimeout(chatPersistTimer);
        chatPersistTimer = null;
        if (currentLoadedId && !get().isHydrating) {
          await persistNow();
        }
      }

      // 프로젝트 전환 시, 기존 채팅 상태를 프로젝트 스코프로 재구성
      if (!projectId) {
        set({
          sessions: [],
          currentSessionId: null,
          currentSession: null,
          isHydrating: false,
          loadedProjectId: null,
        });
        return;
      }

      set({ isHydrating: true, error: null, loadedProjectId: null });

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
          loadedProjectId: projectId, // 로드 성공 후에만 ID 설정 (저장 허용)
          sessions: session ? [session] : [],
          currentSessionId: session?.id ?? null,
          currentSession: session ?? null,
          lastSummaryAtMessageCountBySessionId: session ? { [session.id]: 0 } : {},
        };

        if (settings) {
          // Migration: systemPromptOverlay -> translatorPersona
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const legacy = (settings as any).systemPromptOverlay;

          nextState.translatorPersona = settings.translatorPersona?.trim()
            ? settings.translatorPersona
            : (legacy || DEFAULT_TRANSLATOR_PERSONA);

          nextState.translationRules = settings.translationRules ?? '';
          nextState.projectContext = settings.projectContext ?? settings.activeMemory ?? '';
          nextState.composerText = settings.composerText ?? '';
          nextState.translationContextSessionId = settings.translationContextSessionId ?? null;
        } else {
          // 설정이 없으면 기본값 유지
          nextState.translatorPersona = DEFAULT_TRANSLATOR_PERSONA;
          nextState.translationRules = '';
          nextState.projectContext = '';
          nextState.composerText = '';
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

      // question 모드에서만 최근 채팅 히스토리(최대 10개)를 모델 컨텍스트에 포함
      // - translate 모드는 채팅에서 처리하지 않음(Translate Preview→Apply로 유도)
      const priorMessages = (get().currentSession?.messages ?? []).slice(-10);

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
        const projectContextRaw = get().projectContext?.trim();

        const needsOneQuestion = !translationRulesRaw && !projectContextRaw;
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
        const translatorPersona = get().translatorPersona;

        const contextBlockIds = session?.contextBlockIds ?? [];
        const contextBlocks =
          project
            ? contextBlockIds
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
            : [];
        const translationRulesRaw = get().translationRules;
        const projectContextRaw = get().projectContext;
        // 채팅(Question): 문서는 기본적으로 payload에 인라인 포함하지 않고, 필요 시 Tool로 on-demand 조회합니다.

        const translationRules = translationRulesRaw
          ? maskGhostChips(translationRulesRaw, maskSession)
          : '';
        const projectContext = projectContextRaw ? maskGhostChips(projectContextRaw, maskSession) : '';

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

        // 질문(question) 모드: 최근 히스토리(최대 10개) 포함
        const recent: ChatMessage[] = priorMessages;

        const assistantId = addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: cfg.model, toolCallsInProgress: [] },
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
            translatorPersona,
            translationRules,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            projectContext,
            // 채팅은 항상 "question"으로 호출 (자동 번역 모드 진입 방지)
            requestType: 'question',
          },
          {
            onToken: (full) => {
              if (assistantId) {
                updateMessage(assistantId, { content: restoreGhostChips(full, maskSession) });
              }
            },
            onToolCall: (evt) => {
              if (!assistantId) return;
              const sessionNow = get().currentSession;
              const msgNow = sessionNow?.messages.find((m) => m.id === assistantId);
              
              // 1. Tool Call Badge (Running state)
              const prev = msgNow?.metadata?.toolCallsInProgress ?? [];
              const next =
                evt.phase === 'start'
                  ? prev.includes(evt.toolName) ? prev : [...prev, evt.toolName]
                  : prev.filter((n) => n !== evt.toolName);
              
              // 2. Suggestion Handling (Smart Buttons)
              let nextMetadata = msgNow?.metadata ?? {};
              
              // suggest_* 툴이 호출되면 해당 내용을 메타데이터에 기록
              if (evt.phase === 'start' && evt.args) {
                if (evt.toolName === 'suggest_translation_rule' && evt.args.rule) {
                  nextMetadata = {
                    ...nextMetadata,
                    suggestion: { type: 'rule', content: evt.args.rule },
                  };
                } else if (evt.toolName === 'suggest_project_context' && (evt.args.context || evt.args.memory)) {
                  const content = evt.args.context ?? evt.args.memory;
                  nextMetadata = {
                    ...nextMetadata,
                    suggestion: { type: 'context', content },
                  };
                }
              }

              updateMessage(assistantId, {
                metadata: {
                  ...nextMetadata,
                  toolCallsInProgress: next,
                },
              });
            },
            onToolsUsed: (toolsUsed) => {
              if (assistantId) {
                updateMessage(assistantId, { metadata: { toolsUsed } });
              }
            },
          },
        );

        if (assistantId) {
          updateMessage(assistantId, { content: restoreGhostChips(replyMasked, maskSession) });
          updateMessage(assistantId, { metadata: { toolCallsInProgress: [] } });
        }

        restoreGhostChips(replyMasked, maskSession);
        set({ isLoading: false, streamingMessageId: null });
        get().checkAndSuggestProjectContext();
      } catch (error) {
        const assistantId = get().streamingMessageId;
        if (assistantId) {
          get().updateMessage(assistantId, { metadata: { toolCallsInProgress: [] } });
        }
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

    checkAndSuggestProjectContext: (): void => {
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
          summarySuggestionReason: '대화가 길어져서 맥락 정보 요약(Project Context)을 생성하면 컨텍스트 비용을 줄일 수 있어요.',
        });
      }
    },

    dismissSummarySuggestion: (): void => {
      set({ summarySuggestionOpen: false, summarySuggestionReason: '' });
    },

    generateProjectContextSummary: async (): Promise<void> => {
      const session = get().currentSession;
      if (!session) return;
      if (get().isSummarizing) return;

      set({ isSummarizing: true, error: null });

      try {
        const cfg = getAiConfig();
        const project = useProjectStore.getState().project;
        const current = get().projectContext.trim();

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
          '너는 번역 프로젝트의 "Project Context(맥락 정보)"만 요약하는 에디터 보조 AI다.',
          '',
          '목표:',
          '- 아래 대화에서 확정된 "맥락 정보(배경 지식, 프로젝트 컨텍스트 등)"만 추출해 짧게 요약한다.',
          '- 번역 규칙(포맷, 서식, 문체)은 Translation Rules에 저장되므로 Project Context에 포함하지 않는다.',
          '- 번역 내용 자체를 재작성/제안하지 않는다.',
          '',
          '출력 규칙:',
          '- 출력은 한국어로.',
          '- 최대 1200자.',
          '- 불릿/번호/따옴표/마크다운 금지. (그냥 줄바꿈으로 규칙만 나열)',
          '- 확정되지 않은 내용은 포함하지 않는다.',
          '',
          current ? `기존 Project Context(있으면 갱신/정리):\n${current}\n` : '',
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
          ...(current ? { projectContext: current } : {}),
        });

        const cleaned = reply.trim().slice(0, 1200);
        set((state) => ({
          projectContext: cleaned,
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

      // question 모드에서만: 해당 메시지 "이전"까지의 히스토리(최대 10개) 포함
      const idx = session.messages.findIndex((m) => m.id === messageId);
      const priorMessages = idx > 0 ? session.messages.slice(Math.max(0, idx - 10), idx) : [];

      // request 단위 Ghost mask (무결성 보호)
      const maskSession = createGhostMaskSession();
      const maskedUserContent = maskGhostChips(content, maskSession);

      // 번역 요청은 채팅에서 처리하지 않음 (기존 로직 재사용)
      if (req === 'translate') {
        const translationRulesRaw = get().translationRules?.trim();
        const projectContextRaw = get().projectContext?.trim();
        const needsOneQuestion = !translationRulesRaw && !projectContextRaw;
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
        const translatorPersona = get().translatorPersona;

        const contextBlockIds = session.contextBlockIds ?? [];
        const contextBlocks =
          project
            ? contextBlockIds
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
            : [];
        const translationRulesRaw = get().translationRules;
        const projectContextRaw = get().projectContext;
        // 채팅(Question): 문서는 기본적으로 payload에 인라인 포함하지 않고, 필요 시 Tool로 on-demand 조회합니다.

        const translationRules = translationRulesRaw
          ? maskGhostChips(translationRulesRaw, maskSession)
          : '';
        const projectContext = projectContextRaw ? maskGhostChips(projectContextRaw, maskSession) : '';

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

        // 질문(question) 모드: 최근 히스토리(최대 10개) 포함
        const recent: ChatMessage[] = priorMessages;

        const assistantId = get().addMessage({
          role: 'assistant',
          content: '',
          metadata: { model: cfg.model, toolCallsInProgress: [] },
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
            translatorPersona,
            translationRules,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            projectContext,
            requestType: 'question',
          },
          {
            onToken: (full) => {
              if (assistantId) {
                get().updateMessage(assistantId, { content: restoreGhostChips(full, maskSession) });
              }
            },
            onToolCall: (evt) => {
              if (!assistantId) return;
              const sessionNow = get().currentSession;
              const msgNow = sessionNow?.messages.find((m) => m.id === assistantId);
              const prev = msgNow?.metadata?.toolCallsInProgress ?? [];
              const next =
                evt.phase === 'start'
                  ? prev.includes(evt.toolName) ? prev : [...prev, evt.toolName]
                  : prev.filter((n) => n !== evt.toolName);
              get().updateMessage(assistantId, { metadata: { toolCallsInProgress: next } });
            },
            onToolsUsed: (toolsUsed) => {
              if (assistantId) {
                get().updateMessage(assistantId, { metadata: { toolsUsed } });
              }
            },
          },
        );

        if (assistantId) {
          get().updateMessage(assistantId, { content: restoreGhostChips(replyMasked, maskSession) });
          get().updateMessage(assistantId, { metadata: { toolCallsInProgress: [] } });
        }

        set({ isLoading: false, streamingMessageId: null });
        get().checkAndSuggestProjectContext();
        schedulePersist();
      } catch (error) {
        const assistantId = get().streamingMessageId;
        if (assistantId) {
          get().updateMessage(assistantId, { metadata: { toolCallsInProgress: [] } });
        }
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

    setTranslatorPersona: (persona: string): void => {
      set({ translatorPersona: persona });
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

    setProjectContext: (memory: string): void => {
      set({ projectContext: memory });
      schedulePersist();
    },

    appendToProjectContext: (snippet: string): void => {
      const incoming = snippet.trim();
      if (!incoming) return;
      const current = get().projectContext.trim();
      const next = current.length > 0 ? `${current}\n\n${incoming}` : incoming;
      set({ projectContext: next });
      schedulePersist();
    },

    setTranslationContextSessionId: (sessionId: string | null): void => {
      set({ translationContextSessionId: sessionId });
      schedulePersist();
    },
  };
});

