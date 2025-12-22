import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ChatSession, ChatMessage, EditorBlock, GlossaryEntry } from '@/types';
import { streamAssistantReply } from '@/ai/chat';
import { getAiConfig } from '@/ai/config';
import { useProjectStore } from '@/stores/projectStore';
import { buildTargetDocument } from '@/editor/targetDocument';
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
  collectGhostChipSet,
  diffMissingGhostChips,
} from '@/utils/ghostMask';
import { stripHtml } from '@/utils/hash';

const CHAT_PERSIST_DEBOUNCE_MS = 800;
let chatPersistTimer: number | null = null;
let chatPersistInFlight = false;
let chatPersistQueued = false;

// ============================================
// Store State Interface
// ============================================

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSession: ChatSession | null;
  isLoading: boolean;
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
  referenceNotes: string;
  activeMemory: string;
  includeSourceInPayload: boolean;
  includeTargetInPayload: boolean;
}

interface ChatActions {
  // 세션 관리
  createSession: (name?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;

  // 메시지 관리
  sendMessage: (content: string) => Promise<void>;
  /**
   * Apply 전용 요청
   * - 레거시: blockId 기반(기존 TipTap 프로토타입)
   * - 신규: Target 단일 문서(selection + 주변 문맥) 기반
   */
  sendApplyRequest: (params: {
    // legacy (block 기반)
    blockId?: string;
    // selection 기반
    selectionText?: string;
    beforeText?: string;
    afterText?: string;
    startOffset?: number;
    endOffset?: number;
    userInstruction?: string;
  }) => Promise<void>;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string | null;
  updateMessage: (
    messageId: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
  ) => void;
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
  setReferenceNotes: (notes: string) => void;
  setActiveMemory: (memory: string) => void;
  setIncludeSourceInPayload: (val: boolean) => void;
  setIncludeTargetInPayload: (val: boolean) => void;

  // Persistence (project-scoped)
  hydrateForProject: (projectId: string | null) => Promise<void>;
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
    referenceNotes: get().referenceNotes,
    activeMemory: get().activeMemory,
    composerText: get().composerText,
    includeSourceInPayload: get().includeSourceInPayload,
    includeTargetInPayload: get().includeTargetInPayload,
  });

  const persistNow = async (): Promise<void> => {
    if (!isTauriRuntime()) return;
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
    summarySuggestionOpen: false,
    summarySuggestionReason: '',
    lastSummaryAtMessageCountBySessionId: {},
    composerText: '',
    composerFocusNonce: 0,
    systemPromptOverlay: '',
    referenceNotes: '',
    activeMemory: '',
    includeSourceInPayload: false,
    includeTargetInPayload: false,

    hydrateForProject: async (projectId: string | null): Promise<void> => {
      // 프로젝트 전환 시, 기존 채팅 상태를 프로젝트 스코프로 재구성
      // (요구사항: 현재 세션 1개 + ChatPanel 설정 저장/복원)
      set({
        sessions: [],
        currentSessionId: null,
        currentSession: null,
        streamingMessageId: null,
        error: null,
        lastInjectedGlossary: [],
        isLoading: false,
        // settings는 로드 결과에 따라 갱신
        systemPromptOverlay: '',
        referenceNotes: '',
        activeMemory: '',
        composerText: '',
        includeSourceInPayload: false,
        includeTargetInPayload: false,
      });

      if (!projectId) return;
      if (!isTauriRuntime()) return;

      try {
        const [session, settings] = await Promise.all([
          loadCurrentChatSession(projectId),
          loadChatProjectSettings(projectId),
        ]);

        if (session) {
          set({
            sessions: [session],
            currentSessionId: session.id,
            currentSession: session,
            lastSummaryAtMessageCountBySessionId: { [session.id]: 0 },
          });
        }

        if (settings) {
          set({
            systemPromptOverlay: settings.systemPromptOverlay,
            referenceNotes: settings.referenceNotes,
            activeMemory: settings.activeMemory,
            composerText: settings.composerText ?? '',
            includeSourceInPayload: settings.includeSourceInPayload,
            includeTargetInPayload: settings.includeTargetInPayload,
          });
        }
      } catch (e) {
        set({
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

      // request 단위 Ghost mask (무결성 보호)
      const maskSession = createGhostMaskSession();
      const maskedUserContent = maskGhostChips(content, maskSession);

      // 사용자 메시지 추가
      addMessage({ role: 'user', content });

      set({ isLoading: true, error: null });

      try {
        const cfg = getAiConfig();
        const session = get().currentSession;
        const project = useProjectStore.getState().project;
        const currentSourceDocument = useProjectStore.getState().sourceDocument;
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
        const referenceNotesRaw = get().referenceNotes;
        const activeMemoryRaw = get().activeMemory;
        const includeSource = get().includeSourceInPayload;
        const includeTarget = get().includeTargetInPayload;
        const sourceDocumentRaw = includeSource ? currentSourceDocument : undefined;
        const targetDocumentRaw = includeTarget ? useProjectStore.getState().targetDocument : undefined;

        const referenceNotes = referenceNotesRaw
          ? maskGhostChips(referenceNotesRaw, maskSession)
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
          // 글로서리 검색 실패는 조용히 무시(모델 호출 UX 방해 최소화)
          set({ lastInjectedGlossary: [] });
        }

        const maxN = cfg.maxRecentMessages;
        const fullHistory = session?.messages ?? [];
        const recent = fullHistory.slice(Math.max(0, fullHistory.length - maxN));

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
            referenceNotes,
            ...(glossaryInjected ? { glossaryInjected } : {}),
            ...(fallbackSourceText ? { fallbackSourceText } : {}),
            activeMemory,
            ...(sourceDocument ? { sourceDocument } : {}),
            ...(targetDocument ? { targetDocument } : {}),
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

        const reply = restoreGhostChips(replyMasked, maskSession);

        // --- Context Capture (Smart Match) ---
        let selectionStartOffset: number | undefined;
        let selectionEndOffset: number | undefined;
        let selectionText: string | undefined;

        const targetDocHandle = useProjectStore.getState().targetDocHandle;
        if (targetDocHandle?.getSelection) {
          const sel = targetDocHandle.getSelection();
          if (sel) {
            selectionStartOffset = sel.startOffset;
            selectionEndOffset = sel.endOffset;
            selectionText = sel.text;
          }
        }
        // -------------------------------------

        // --- Judge Integration for Normal Messsages ---
        set({ isLoading: false, streamingMessageId: null });

        // Basic Heuristic: If it looks like a translation request or contains code-like structure,
        // we ask the Judge. For now, let's be generous: Any assistant reply might be "Applyable".
        // But to avoid over-triggering, we can check if it contains at least some Korean/English mix or length.

        // Judge Integration (Async - "Pop-in" Apply button)
        (async () => {
          try {
            // Dynamic import
            const { evaluateApplyReadiness } = await import('@/ai/judge');

            // Restore ghost chips in user content for accurate semantic analysis
            const restoredUserContent = restoreGhostChips(maskedUserContent, maskSession);

            const judgeResult = await evaluateApplyReadiness({
              userRequest: restoredUserContent,
              aiResponse: reply,
            });

            if (judgeResult.decision === 'APPLY') {
              const cleanText = judgeResult.cleanText || reply;
              if (assistantId) {
                updateMessage(assistantId, {
                  metadata: {
                    appliable: true,
                    ...(cleanText !== reply ? { cleanContent: cleanText } : {}),
                    ...(typeof selectionStartOffset === 'number' ? { selectionStartOffset } : {}),
                    ...(typeof selectionEndOffset === 'number' ? { selectionEndOffset } : {}),
                    ...(typeof selectionText === 'string' ? { selectionText } : {}),
                  }
                });
              }
            }
          } catch (e) {
            console.error('[ChatStore] Judge failed:', e);
          }
        })();

        set({ isLoading: false, streamingMessageId: null });
        // ----------------------------------------------
        // ----------------------------------------------

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

    /**
     * Apply 전용 요청:
     * - 선택된 블록이 속한 SegmentGroup의 원문+번역을 body에 포함
     * - 모델 출력은 (선택 구간이 있으면) "선택 구간 대체 텍스트만", 없으면 "번역문 전체"만 요구
     * - assistant 메시지에 appliable=true를 달아 Apply 버튼이 노출되게 함
     */
    sendApplyRequest: async (params: {
      blockId?: string;
      selectionText?: string;
      beforeText?: string;
      afterText?: string;
      startOffset?: number;
      endOffset?: number;
      userInstruction?: string;
    }): Promise<void> => {
      const { currentSession, createSession, addMessage, updateMessage } = get();

      if (!currentSession) {
        createSession();
      }

      set({ isLoading: true, error: null });

      try {
        const cfg = getAiConfig();
        const session = get().currentSession;
        const project = useProjectStore.getState().project;
        const targetDocHandle = useProjectStore.getState().targetDocHandle;
        const currentSourceDocument = useProjectStore.getState().sourceDocument;
        const systemPromptOverlay = get().systemPromptOverlay;
        const referenceNotes = get().referenceNotes;
        const activeMemory = get().activeMemory;
        const includeSource = get().includeSourceInPayload;
        const includeTarget = get().includeTargetInPayload;

        if (!project) {
          throw new Error('프로젝트가 로드되지 않았습니다.');
        }

        const legacyBlockId = params.blockId;
        const selectionRaw = params.selectionText?.trim();
        const before = params.beforeText?.trim();
        const after = params.afterText?.trim();
        const selectionStartOffset = params.startOffset;
        const selectionEndOffset = params.endOffset;
        const additionalInstruction = params.userInstruction?.trim();

        const maskSession = createGhostMaskSession();
        const requiredGhostSet = selectionRaw ? collectGhostChipSet(selectionRaw) : new Set<string>();
        const selection = selectionRaw ? maskGhostChips(selectionRaw, maskSession) : undefined;

        // 컨텍스트 수집 도우미: selection offset → block/segment 매핑 → source/target 컨텍스트
        const collectContextFromSelection = (): {
          applyTargetId?: string;
          contextBlocks: EditorBlock[];
        } => {
          if (
            typeof selectionStartOffset !== 'number' ||
            typeof selectionEndOffset !== 'number' ||
            selectionEndOffset <= selectionStartOffset
          ) {
            return { contextBlocks: [] };
          }

          // 최신 tracked ranges가 있으면 그것을 우선 사용
          const ranges: Record<string, { startOffset: number; endOffset: number }> =
            ((targetDocHandle?.getBlockOffsets?.() as unknown) as
              | Record<string, { startOffset: number; endOffset: number }>
              | undefined) ?? buildTargetDocument(project).blockRanges;

          const overlappingTargetIds = Object.entries(ranges)
            .filter(([, r]) => selectionStartOffset < r.endOffset && selectionEndOffset > r.startOffset)
            .map(([bid]) => bid);

          if (overlappingTargetIds.length === 0) {
            return { contextBlocks: [] };
          }

          const contextBlockIds = new Set<string>();
          for (const targetId of overlappingTargetIds) {
            const seg = project.segments.find((s) => s.targetIds.includes(targetId));
            if (!seg) continue;
            seg.sourceIds.forEach((id) => contextBlockIds.add(id));
            seg.targetIds.forEach((id) => contextBlockIds.add(id));
          }

          const applyTargetId = overlappingTargetIds[0];
          if (!applyTargetId) {
            return { contextBlocks: [] };
          }
          const contextBlocks = [...contextBlockIds]
            .map((id) => project.blocks[id])
            .filter((b): b is NonNullable<typeof b> => b !== undefined);

          return { applyTargetId, contextBlocks };
        };

        // 레거시(blockId)면 기존 방식대로 segment 컨텍스트 (향후 제거 예정)
        // selection offset 기반이면 자동 매핑으로 source/target 컨텍스트 주입
        let applyTargetId: string | undefined;
        let contextBlocks: EditorBlock[] = [];
        let fallbackSourceText: string | undefined;
        if (legacyBlockId) {
          const seg = project.segments.find(
            (s) => s.sourceIds.includes(legacyBlockId) || s.targetIds.includes(legacyBlockId),
          );
          if (seg) {
            const sourceIds = seg.sourceIds;
            const targetIds = seg.targetIds;
            applyTargetId = targetIds[0];
            get().setContextBlocks([...new Set([...sourceIds, ...targetIds])]);
            contextBlocks = [...new Set([...sourceIds, ...targetIds])]
              .map((id) => project.blocks[id])
              .filter((b): b is NonNullable<typeof b> => b !== undefined);
          } else {
            const selCtx = collectContextFromSelection();
            applyTargetId = selCtx.applyTargetId;
            contextBlocks = selCtx.contextBlocks;
            get().setContextBlocks(selCtx.contextBlocks.map((b) => b.id));
          }
        } else {
          const selCtx = collectContextFromSelection();
          applyTargetId = selCtx.applyTargetId;
          contextBlocks = selCtx.contextBlocks;
          get().setContextBlocks(selCtx.contextBlocks.map((b) => b.id));
        }

        // 컨텍스트 실패 시 원문 전체를 fallback으로 주입
        if (contextBlocks.length === 0 && currentSourceDocument) {
          fallbackSourceText = currentSourceDocument;
        }

        const sourceDocument = includeSource ? currentSourceDocument : undefined;
        const targetDocument = includeTarget ? useProjectStore.getState().targetDocument : undefined;

        const maxN = cfg.maxRecentMessages;
        const fullHistory = session?.messages ?? [];
        const recent = fullHistory.slice(Math.max(0, fullHistory.length - maxN));

        // 로컬 글로서리 주입(on-demand)
        let glossaryInjected = '';
        try {
          const plainContext = contextBlocks
            .map((b) => stripHtml(b.content))
            .join('\n')
            .slice(0, 1200);
          const q = [selectionRaw ?? '', before ?? '', after ?? '', plainContext]
            .filter(Boolean)
            .join('\n')
            .slice(0, 2000);
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
        } catch {
          set({ lastInjectedGlossary: [] });
        }

        // 사용자 메시지(프롬프트) 구성 (selection 기반을 1순위로)
        const userMessage = selection
          ? [
            '아래 원문/번역을 참고해서, 번역문에서 **선택된 구간만** 더 자연스럽게 다듬어줘.',
            '',
            '요구사항:',
            '- 출력은 **선택 구간의 대체 텍스트만** 작성해줘. (설명/불릿/번호/따옴표 없이)',
            '- 고유명사/의미는 유지하고, 문체는 자연스럽게.',
            additionalInstruction ? `- 추가 요청: ${additionalInstruction}` : '',
            '',
            `선택 구간(번역문 일부): ${selection}`,
            '',
            before || after
              ? [
                '번역문 주변 문맥(참고용):',
                before ? `- BEFORE: ${before}` : '',
                after ? `- AFTER: ${after}` : '',
              ].filter(Boolean).join('\n')
              : '',
          ]
            .filter(Boolean)
            .join('\n')
          : [
            '아래 원문/번역을 참고해서 번역문을 더 자연스럽게 다듬어줘.',
            '',
            '요구사항:',
            '- 출력은 **개선된 번역문 전체만** 작성해줘. (설명/불릿/번호/따옴표 없이)',
            '- 고유명사/의미는 유지하고, 문체는 자연스럽게.',
            additionalInstruction ? `- 추가 요청: ${additionalInstruction}` : '',
          ]
            .filter(Boolean)
            .join('\n');

        // 사용자 메시지 추가(Apply intent 표시)
        addMessage({
          role: 'user',
          content: userMessage,
          metadata: {
            ...(applyTargetId ? { suggestedBlockId: applyTargetId } : {}),
            appliable: false,
            ...(selectionRaw ? { selectionText: selectionRaw } : {}),
            ...(typeof selectionStartOffset === 'number'
              ? { selectionStartOffset }
              : {}),
            ...(typeof selectionEndOffset === 'number' ? { selectionEndOffset } : {}),
          },
        });

        const assistantId = addMessage({
          role: 'assistant',
          content: '',
          metadata: {
            ...(applyTargetId ? { suggestedBlockId: applyTargetId } : {}),
            appliable: false,
            ...(selectionRaw ? { selectionText: selectionRaw } : {}),
            ...(typeof selectionStartOffset === 'number' ? { selectionStartOffset } : {}),
            ...(typeof selectionEndOffset === 'number' ? { selectionEndOffset } : {}),
          },
        });
        if (assistantId) {
          set({ streamingMessageId: assistantId });
        }

        const replyMasked = await streamAssistantReply(
          {
            project,
            contextBlocks,
            recentMessages: recent,
            userMessage,
            systemPromptOverlay,
            referenceNotes: referenceNotes ? maskGhostChips(referenceNotes, maskSession) : '',
            ...(glossaryInjected ? { glossaryInjected } : {}),
            ...(fallbackSourceText ? { fallbackSourceText } : {}),
            activeMemory: activeMemory ? maskGhostChips(activeMemory, maskSession) : '',
            ...(sourceDocument ? { sourceDocument: maskGhostChips(sourceDocument, maskSession) } : {}),
            ...(targetDocument ? { targetDocument: maskGhostChips(targetDocument, maskSession) } : {}),
          },
          {
            onToken: (full) => {
              if (assistantId) {
                updateMessage(assistantId, { content: restoreGhostChips(full, maskSession) });
              }
            },
          },
        );

        const reply = restoreGhostChips(replyMasked, maskSession);

        // Edit(선택 구간) 응답 무결성 검증
        const missing = selectionRaw ? diffMissingGhostChips(requiredGhostSet, reply) : [];
        const applyBlockedReason =
          missing.length > 0
            ? `태그/변수 무결성 검증 실패: 다음 토큰이 응답에서 누락/변형되었습니다 → ${missing.join(
              ', ',
            )}`
            : undefined;

        // [FIX] selection이나 instruction이 있으면, 컨텍스트 수집 여부와 상관없이 Apply 의도로 간주합니다.
        // missing ghost chip이 없으면 appliable=true입니다.
        const isApplyIntent = !!(selectionRaw || additionalInstruction || applyTargetId);
        const isAppliable = isApplyIntent && missing.length === 0;

        set({ isLoading: false, streamingMessageId: null });

        // Judge: AI 응답에 대한 apply 여부 및 clean text 추출
        let finalContent = reply;
        let finalAppliable = isAppliable;
        let finalReason = applyBlockedReason;

        if (isAppliable) {
          // AI가 "Here is the ..." 같은 사족을 붙였을 수 있으므로 Judge로 2차 검증/정제
          const { evaluateApplyReadiness } = await import('@/ai/judge');
          // Judge에게는 mask가 복원된 상태로 문의해야 함
          set({ isLoading: true }); // 잠깐 다시 로딩 (judge 진행)

          try {
            const judgeResult = await evaluateApplyReadiness({
              userRequest: restoreGhostChips(userMessage, maskSession), // userMessage도 복원해서 전달
              aiResponse: reply,
            });

            if (judgeResult.decision === 'REJECT') {
              finalAppliable = false;
              finalReason = `[AI Judgment] ${judgeResult.reason}`;
            } else {
              // APPLY 승인 시, 정제된 텍스트가 있으면 교체
              if (judgeResult.cleanText && judgeResult.cleanText !== reply) {
                finalContent = judgeResult.cleanText;
              }
            }
          } catch (e) {
            console.error('[ChatStore] Judge failed:', e);
            // Judge 실패 시 안전하게 Reject
            finalAppliable = false;
            finalReason = `Judge Error: ${String(e)}`;
          } finally {
            set({ isLoading: false });
          }
        }

        if (assistantId) {
          updateMessage(assistantId, {
            content: finalContent,
            metadata: {
              ...(applyTargetId ? { suggestedBlockId: applyTargetId } : {}),
              appliable: finalAppliable,
              ...(selectionRaw ? { selectionText: selectionRaw } : {}),
              ...(typeof selectionStartOffset === 'number' ? { selectionStartOffset } : {}),
              ...(typeof selectionEndOffset === 'number' ? { selectionEndOffset } : {}),
              ...(finalReason ? { applyBlockedReason: finalReason } : {}),
            },
          });
        }

        get().checkAndSuggestActiveMemory();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'AI 응답 생성 실패',
          isLoading: false,
          streamingMessageId: null,
        });
      }
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

    setReferenceNotes: (notes: string): void => {
      set({ referenceNotes: notes });
      schedulePersist();
    },

    setActiveMemory: (memory: string): void => {
      set({ activeMemory: memory });
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
  };
});

