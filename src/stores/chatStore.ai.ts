/**
 * chatStore AI 상호작용 슬라이스 (executeAiReply, sendMessage, replayMessage, streaming)
 */
import type { ChatMessage } from '@/types';
import type { AttachmentDto } from '@/tauri/attachments';
import { streamAssistantReply, type StreamCallbacks } from '@/ai/chat';
import { getAiConfig, resolveModelRunConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { useProjectStore } from '@/stores/projectStore';
import { useConnectorStore } from '@/stores/connectorStore';
import { formatGlossaryForPrompt, resolveGlossaryEntries } from '@/utils/glossaryInject';
import {
  createGhostMaskSession,
  maskGhostChips,
  restoreGhostChips,
} from '@/utils/ghostMask';
import { cleanSuggestionContent } from '@/utils/cleanSuggestionContent';
import { stripHtml } from '@/utils/hash';
import { TOOL_NAME_MAP } from './chatStore.types';
import type { ChatSet, ChatGet } from './chatStore.types';
import {
  tryExtractWebSearchQuery,
  extractTextFromAiMessage,
  inferSuggestionFromAssistantText,
  createIncrementalGhostRestorer,
} from './chatStore.helpers';

// ── ExecuteAiReply Params ──────────────────────────────────────────────

interface ExecuteAiReplyParams {
  /** 이미 resolve된 세션 ID */
  effectiveSessionId: string;
  /** 원본 사용자 메시지 (unmasked) */
  content: string;
  /** 이미 slice된 이전 메시지 */
  priorMessages: ChatMessage[];
  /** 캡처된 첨부파일 */
  capturedAttachments: AttachmentDto[];
  /** replayMessage의 onModelRun 등 추가 콜백 (spread로 머지) */
  extraCallbacks?: Partial<StreamCallbacks>;
  /** 성공 시 schedulePersist() 호출 여부 (replayMessage: true) */
  persistOnSuccess?: boolean;
}

type ToolEnabledModelInvokeOptions = { signal?: AbortSignal };

type ToolEnabledModel = {
  invoke: (input: string, options?: ToolEnabledModelInvokeOptions) => Promise<unknown>;
  bindTools?: (tools: Array<Record<string, unknown>>) => {
    invoke: (input: string, options?: ToolEnabledModelInvokeOptions) => Promise<unknown>;
  };
};

interface BuiltInWebSearchSpec {
  statusMessage: string;
  bindTools: Array<Record<string, unknown>>;
  toolName: string;
}

function getBuiltInWebSearchSpec(provider: string): BuiltInWebSearchSpec | null {
  if (provider === 'openai') {
    return {
      statusMessage: 'OpenAI 웹 검색 중...',
      bindTools: [{ type: 'web_search_preview' }],
      toolName: 'web_search_preview',
    };
  }
  if (provider === 'anthropic') {
    return {
      statusMessage: 'Anthropic 웹 검색 중...',
      bindTools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      toolName: 'web_search',
    };
  }
  return null;
}

/**
 * AbortError 판별
 * - DOMException이 Error를 상속하지 않거나 cross-realm(instanceof 불일치)인 환경도
 *   커버하도록 name 프로퍼티로 판단합니다.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function buildWebSearchPrompt(webQuery: string): string {
  return [
    '웹 검색을 수행한 뒤, 아래 형식으로 간결하게 정리해 주세요.',
    '',
    `- 질문: ${webQuery}`,
    '- 출력:',
    '  1) 요약(3~6줄)',
    '  2) 근거 링크 3~8개 (가능하면 제목 + 링크)',
  ].join('\n');
}

// ── AI Actions ─────────────────────────────────────────────────────────

export function createAiActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void; persistNow: () => Promise<void> },
) {
  const { schedulePersist } = helpers;

  /**
   * abort/에러로 스트리밍이 중단됐을 때 내용이 비어 있는 assistant placeholder를 제거합니다.
   * (L5: abort 후 빈 말풍선이 세션에 영속되는 문제 방지)
   * - 메시지 id 기준 제거라 다른 요청의 메시지에는 영향이 없습니다.
   */
  const removeEmptyAssistantPlaceholder = (sessionId: string, messageId: string | null): void => {
    if (!messageId) return;
    const session = get().sessions.find((s) => s.id === sessionId);
    const message = session?.messages.find((m) => m.id === messageId);
    if (!session || !message) return;
    if (message.role !== 'assistant') return;
    if ((message.content ?? '').trim().length > 0) return;

    const updatedSession = {
      ...session,
      messages: session.messages.filter((m) => m.id !== messageId),
    };
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? updatedSession : s)),
      ...(sessionId === state.currentSessionId ? { currentSession: updatedSession } : {}),
    }));
  };

  // ── 공통 AI 응답 파이프라인 (sendMessage / replayMessage 공용) ──────────

  const executeAiReply = async (params: ExecuteAiReplyParams): Promise<void> => {
    const {
      effectiveSessionId,
      content,
      priorMessages,
      capturedAttachments,
      extraCallbacks,
      persistOnSuccess = false,
    } = params;

    // Ghost mask (request 단위 무결성 보호)
    const maskSession = createGhostMaskSession();
    const maskedUserContent = maskGhostChips(content, maskSession);

    // AbortController: 단일 in-flight 요청 추적
    // L1: 이 컨트롤러를 클로저에 보관하고, 완료/에러 상태를 쓰기 전마다 store의
    // 컨트롤러와 비교해 "아직 이 요청이 스트리밍 상태의 소유자인지"를 검증합니다.
    // (취소/전환된 요청 A의 후속 코드가 새 요청 B의 상태를 덮어쓰는 것 방지)
    const abortController = new AbortController();
    const ownsStream = (): boolean => get().abortController === abortController;
    set({ abortController, isLoading: true, error: null, streamingMessageId: null, statusMessage: '요청 분석 및 컨텍스트 확인 중...' });

    // catch 경로에서도 이 요청의 placeholder를 식별할 수 있도록 try 밖에 보관
    let assistantId: string | null = null;

    try {
      // fresh session 읽기 (caller가 truncation 등으로 변경했을 수 있음)
      const session = get().sessions.find((s) => s.id === effectiveSessionId) ?? null;
      // 요청 실행 설정을 한 번만 캡처: 이후 전역/세션 모델이 바뀌어도 이 요청의 모델은 고정된다.
      // (세션별 modelPreset이 있으면 그것을, 없으면 전역 chat 기본값을 사용)
      const runConfig = resolveModelRunConfig({ ...(session?.modelPreset ? { preset: session.modelPreset } : {}) });
      const project = useProjectStore.getState().project;
      const webSearchEnabled = get().webSearchEnabled;

      const contextBlockIds = session?.contextBlockIds ?? [];
      const contextBlocks =
        project
          ? contextBlockIds
            .map((id) => project.blocks[id])
            .filter((b): b is NonNullable<typeof b> => b !== undefined)
          : [];
      const translationRulesRaw = get().translationRules;
      const projectContextRaw = get().projectContext;

      const translationRules = translationRulesRaw
        ? maskGhostChips(translationRulesRaw, maskSession)
        : '';
      const projectContext = projectContextRaw ? maskGhostChips(projectContextRaw, maskSession) : '';

      // 로컬 글로서리 주입 (on-demand, 문서 전역 윈도우)
      let glossaryInjected = '';
      try {
        if (project?.id) {
          const plainContext = contextBlocks
            .map((b) => stripHtml(b.content))
            .join('\n');
          const q = [content, plainContext].filter(Boolean).join('\n');
          const hits = q.trim().length
            ? await resolveGlossaryEntries({
              projectId: project.id,
              text: q,
              domain: project.metadata.domain,
              limit: 12,
            })
            : [];
          set({ lastInjectedGlossary: hits });
          if (hits.length > 0) {
            const raw = formatGlossaryForPrompt(hits);
            glossaryInjected = maskGhostChips(raw, maskSession);
          }
        } else {
          set({ lastInjectedGlossary: [] });
        }
      } catch {
        // 글로서리 검색 실패는 조용히 무시 (모델 호출 UX 방해 최소화)
        set({ lastInjectedGlossary: [] });
      }

      const recent: ChatMessage[] = priorMessages;

      // Assistant 빈 메시지 추가 (스트리밍 버블)
      // 실행 출처 메타데이터를 캡처된 runConfig에서 만든다(기록 모델 = 실제 호출 모델 보장).
      assistantId = get().addMessage({
        role: 'assistant',
        content: '',
        metadata: {
          requestedModelPreset: runConfig.requestedPreset,
          resolvedModel: runConfig.resolvedModel,
          provider: runConfig.provider === 'mock' ? 'openai' : runConfig.provider,
          ...(runConfig.reasoningEffort ? { reasoningEffort: runConfig.reasoningEffort } : {}),
          toolCallsInProgress: [],
        },
      }, effectiveSessionId);
      if (assistantId) {
        set({ streamingMessageId: assistantId, streamingSessionId: effectiveSessionId });
      }

      // P3: 토큰마다 전체 텍스트를 다시 복원(O(L^2))하지 않도록 증분 복원기 사용
      const restoreStreamingText = createIncrementalGhostRestorer(maskSession);

      // 기본 콜백 + extraCallbacks 머지
      // L1: 각 콜백은 소유권을 잃은 뒤 도착한 지연 이벤트가 새 요청의 상태를
      // 오염시키지 않도록 ownsStream()을 먼저 확인합니다.
      const callbacks: StreamCallbacks = {
        onToken: (full) => {
          if (!ownsStream()) return;
          if (get().statusMessage !== '답변 생성 중...') {
            set({ statusMessage: '답변 생성 중...' });
          }
          set({ streamingContent: restoreStreamingText(full) });
        },
        onToolCall: (evt) => {
          if (!assistantId) return;
          if (!ownsStream()) return;
          const currentMetadata = get().streamingMetadata ?? {};

          if (evt.phase === 'start') {
            const friendlyName = TOOL_NAME_MAP[evt.toolName] || evt.toolName;
            set({ statusMessage: `${friendlyName} 진행 중...` });
          } else {
            set({ statusMessage: '결과 처리 및 답변 생성 중...' });
          }

          // 1. Tool Call Badge (Running state)
          const prev = currentMetadata.toolCallsInProgress ?? [];
          const next =
            evt.phase === 'start'
              ? prev.includes(evt.toolName) ? prev : [...prev, evt.toolName]
              : prev.filter((n) => n !== evt.toolName);

          // 2. Suggestion Handling (Smart Buttons)
          let nextMetadata = { ...currentMetadata };
          if (evt.phase === 'start' && evt.args) {
            if (evt.toolName === 'suggest_translation_rule' && evt.args.rule) {
              const prev = nextMetadata.suggestedRule ?? '';
              const cleaned = cleanSuggestionContent(String(evt.args.rule));
              nextMetadata = {
                ...nextMetadata,
                suggestedRule: prev ? `${prev}; ${cleaned}` : cleaned,
              };
            } else if (evt.toolName === 'suggest_project_context' && evt.args.context) {
              const prev = nextMetadata.suggestedContext ?? '';
              const cleaned = cleanSuggestionContent(String(evt.args.context));
              nextMetadata = {
                ...nextMetadata,
                suggestedContext: prev ? `${prev}; ${cleaned}` : cleaned,
              };
            }
          }

          set({
            streamingMetadata: {
              ...nextMetadata,
              toolCallsInProgress: next,
            },
          });
        },
        onToolsUsed: (toolsUsed) => {
          if (!ownsStream()) return;
          const currentMetadata = get().streamingMetadata ?? {};
          set({
            streamingMetadata: { ...currentMetadata, toolsUsed },
          });
        },
        onUsage: (usage) => {
          if (!ownsStream()) return;
          const currentMetadata = get().streamingMetadata ?? {};
          set({
            streamingMetadata: {
              ...currentMetadata,
              ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
              ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
              ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
            },
          });
        },
        ...extraCallbacks,
      };

      const replyMasked = await streamAssistantReply(
        {
          project,
          contextBlocks,
          recentMessages: recent,
          userMessage: maskedUserContent,
          translationRules,
          ...(glossaryInjected ? { glossaryInjected } : {}),
          projectContext,
          requestType: 'question',
          abortSignal: abortController.signal,
          attachments: capturedAttachments
            .filter((a) => a.extractedText)
            .map((a) => ({ filename: a.filename, text: a.extractedText! })),
          imageAttachments: capturedAttachments
            .filter((a) => !!a.filePath && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(String(a.fileType).toLowerCase()))
            .map((a) => ({ filename: a.filename, fileType: a.fileType, filePath: a.filePath! })),
          webSearchEnabled,
          confluenceSearchEnabled: session?.confluenceSearchEnabled ?? false,
          notionSearchEnabled: (() => {
            const { enabledMap, tokenMap } = useConnectorStore.getState();
            return (enabledMap['notion'] ?? false) && (tokenMap['notion'] ?? false);
          })(),
        },
        runConfig,
        callbacks,
      );

      // L1: 소유권(epoch) 가드. streamAssistantReply는 청크 사이에서만 abort를
      // 확인하므로, 마지막 청크 이후 취소/전환된 요청도 정상 resolve될 수 있습니다.
      // 소유권을 잃었으면 새 요청의 상태(streamingContent/streamingMessageId 등)를
      // 덮지 않도록 즉시 중단하고, 이 요청의 빈 placeholder만 정리합니다.
      if (!ownsStream()) {
        removeEmptyAssistantPlaceholder(effectiveSessionId, assistantId);
        return;
      }

      // Finalization
      if (assistantId) {
        const restored = restoreGhostChips(replyMasked, maskSession);

        // Tool-call 누락 시 텍스트 기반 폴백 (Smart Buttons)
        const currentMetadata = get().streamingMetadata ?? {};
        if (!currentMetadata.suggestedRule && !currentMetadata.suggestedContext) {
          const inferred = inferSuggestionFromAssistantText(restored);
          if (inferred) {
            set({ streamingMetadata: { ...currentMetadata, ...inferred } });
          }
        }

        set({ streamingContent: restored });
        // L1: 이 요청의 placeholder id를 명시 전달 (다른 요청의 placeholder에 커밋 방지)
        get().finalizeStreaming(assistantId);
      }

      set({ abortController: null });
      if (persistOnSuccess) {
        schedulePersist();
      }
    } catch (error) {
      // AbortError는 정상적인 취소이므로 에러로 표시하지 않음
      if (isAbortError(error)) {
        // L5: abort로 커밋되지 못한 빈 assistant placeholder 제거 (빈 말풍선 영속 방지)
        removeEmptyAssistantPlaceholder(effectiveSessionId, assistantId);
        // L1: 이미 다른 요청이 시작됐으면 그 요청의 진행 상태를 건드리지 않음
        if (!ownsStream()) return;
        set({
          isLoading: false,
          streamingMessageId: null,
          streamingSessionId: null,
          streamingContent: null,
          streamingMetadata: null,
          statusMessage: null,
          abortController: null,
          isFinalizingStreaming: false,
        });
        return;
      }

      // L1: stale 요청의 에러가 새 요청의 상태/메시지를 오염시키지 않도록 중단
      if (!ownsStream()) {
        removeEmptyAssistantPlaceholder(effectiveSessionId, assistantId);
        return;
      }

      const errText = error instanceof Error ? error.message : 'AI 응답 생성 실패';
      if (assistantId) {
        get().updateMessage(assistantId, {
          content: `⚠️ ${errText}`,
          metadata: { toolCallsInProgress: [] },
        }, effectiveSessionId);
      } else {
        get().addMessage({ role: 'assistant', content: `⚠️ ${errText}` }, effectiveSessionId);
      }
      set({
        error: errText,
        isLoading: false,
        streamingMessageId: null,
        streamingSessionId: null,
        streamingContent: null,
        streamingMetadata: null,
        statusMessage: null,
        abortController: null,
        isFinalizingStreaming: false,
      });
    }
  };

  // ── sendMessage ──────────────────────────────────────────────────────

  const sendMessage = async (content: string, targetSessionId?: string): Promise<void> => {
    // Race Condition 방지: finalization 진행 중이면 완료 대기
    if (get().isFinalizingStreaming) {
      // 최대 1초 대기 (100ms 간격으로 체크)
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!get().isFinalizingStreaming) break;
      }
      // 여전히 진행 중이면 강제 완료
      if (get().isFinalizingStreaming) {
        set({ isFinalizingStreaming: false, streamingMessageId: null, streamingSessionId: null, streamingContent: null, streamingMetadata: null });
      }
    }

    // 동시 2개 스트리밍은 지원하지 않음: 진행 중이면 새 요청을 무시
    if (get().isLoading || get().abortController) {
      return;
    }

    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const { createSession, addMessage, updateMessage } = get();

    // 세션이 없으면 생성
    if (!resolvedSessionId || !get().sessions.find((s) => s.id === resolvedSessionId)) {
      createSession();
    }

    // 실제 사용할 세션 ID (createSession 직후일 수 있으므로 다시 resolve)
    const effectiveSessionId = resolvedSessionId && get().sessions.find((s) => s.id === resolvedSessionId)
      ? resolvedSessionId
      : get().currentSessionId;

    if (!effectiveSessionId) {
      console.error('[Chat] No active session');
      return;
    }

    // 최근 채팅 히스토리를 모델 컨텍스트에 포함
    const maxRecent = getAiConfig().maxRecentMessages;
    const targetSession = get().sessions.find((s) => s.id === effectiveSessionId);
    const priorMessages = (targetSession?.messages ?? []).slice(-maxRecent);

    // 전송 시작 시점에 첨부 파일 캡처 후 즉시 초기화 (입력창 썸네일 즉시 제거)
    const capturedAttachments = get().composerAttachments;
    set({ composerAttachments: [] });

    // 사용자 메시지에 이미지 정보 포함 (채팅 UI 표시용)
    const imageAttachmentsForMessage = capturedAttachments
      .filter((a) => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(a.fileType.toLowerCase()) && a.thumbnailDataUrl)
      .map((a) => ({ filename: a.filename, thumbnailDataUrl: a.thumbnailDataUrl! }));

    addMessage({
      role: 'user',
      content,
      ...(imageAttachmentsForMessage.length > 0
        ? { metadata: { imageAttachments: imageAttachmentsForMessage } }
        : {}),
    }, effectiveSessionId);

    // [Auto-Title] 첫 메시지인 경우 세션 이름 자동 변경
    const sessionAfterAdd = get().sessions.find((s) => s.id === effectiveSessionId);
    if (sessionAfterAdd && sessionAfterAdd.messages.length === 1) {
      const newTitle = content.trim().slice(0, 20) + (content.length > 20 ? '...' : '');
      get().renameSession(sessionAfterAdd.id, newTitle);
    }

    // 명시적 웹검색 트리거: /web 명령어로 내장 웹검색을 직접 실행
    const webQuery = tryExtractWebSearchQuery(content);
    if (webQuery) {
      if (!get().webSearchEnabled) {
        addMessage({
          role: 'assistant',
          content: '웹 검색이 꺼져 있어 실행하지 않았습니다. 채팅 입력창의 + 메뉴에서 "웹 검색"을 켜면 사용할 수 있어요.',
        }, effectiveSessionId);
        set({ isLoading: false, streamingMessageId: null, streamingSessionId: null, error: null });
        schedulePersist();
        return;
      }

      // L1: /web 검색 경로도 abortSignal 연결 + 소유권(epoch) 가드 적용
      // (프로젝트 전환 시 hydrateForProject의 abort로 취소 가능해짐)
      const webAbortController = new AbortController();
      const ownsWebSearch = (): boolean => get().abortController === webAbortController;
      set({ abortController: webAbortController, isLoading: true, error: null, statusMessage: '웹 검색 준비 중...' });

      // /web 경로도 run config를 한 번만 캡처 (세션 모델 우선, 이후 전역 변경과 무관)
      const webSession = get().sessions.find((s) => s.id === effectiveSessionId) ?? null;
      const webRunConfig = resolveModelRunConfig({ ...(webSession?.modelPreset ? { preset: webSession.modelPreset } : {}) });
      const webSearchSpec = getBuiltInWebSearchSpec(webRunConfig.provider);
      const initialToolsInProgress = [webSearchSpec?.toolName ?? 'web_search'];

      const assistantId = addMessage({
        role: 'assistant',
        content: '',
        metadata: {
          requestedModelPreset: webRunConfig.requestedPreset,
          resolvedModel: webRunConfig.resolvedModel,
          provider: webRunConfig.provider === 'mock' ? 'openai' : webRunConfig.provider,
          toolCallsInProgress: initialToolsInProgress,
          toolsUsed: [],
        },
      }, effectiveSessionId);

      try {
        let text = '';
        const toolsUsed: string[] = [];

        const modelAny = createChatModel(undefined, { useFor: 'chat', runConfig: webRunConfig }) as unknown as ToolEnabledModel;

        if (webSearchSpec) {
          set({ statusMessage: webSearchSpec.statusMessage });
          const modelWithSearch =
            typeof modelAny.bindTools === 'function'
              ? modelAny.bindTools(webSearchSpec.bindTools)
              : modelAny;

          const ai = await modelWithSearch.invoke(buildWebSearchPrompt(webQuery), { signal: webAbortController.signal });
          text = extractTextFromAiMessage(ai);
          if (text.trim()) toolsUsed.push(webSearchSpec.toolName);
        }

        // L1: 완료 시점 소유권 재검증. 취소/전환된 검색이 새 요청 상태를 덮지 않도록
        if (!ownsWebSearch()) {
          removeEmptyAssistantPlaceholder(effectiveSessionId, assistantId);
          return;
        }

        if (assistantId) {
          updateMessage(assistantId, { content: text, metadata: { toolCallsInProgress: [], toolsUsed } }, effectiveSessionId);
        } else {
          addMessage({ role: 'assistant', content: text }, effectiveSessionId);
        }
        set({ isLoading: false, streamingMessageId: null, streamingSessionId: null, error: null, statusMessage: null, abortController: null });
        schedulePersist();
      } catch (e) {
        // 취소는 에러로 표시하지 않고 빈 placeholder만 정리
        if (isAbortError(e)) {
          removeEmptyAssistantPlaceholder(effectiveSessionId, assistantId);
          if (!ownsWebSearch()) return;
          set({ isLoading: false, streamingMessageId: null, streamingSessionId: null, error: null, statusMessage: null, abortController: null });
          return;
        }
        // L1: 소유권을 잃은 stale 에러는 새 요청 상태를 건드리지 않음
        if (!ownsWebSearch()) {
          removeEmptyAssistantPlaceholder(effectiveSessionId, assistantId);
          return;
        }
        const errText = e instanceof Error ? e.message : '웹 검색 실패';
        if (assistantId) {
          updateMessage(assistantId, { content: `⚠️ ${errText}`, metadata: { toolCallsInProgress: [] } }, effectiveSessionId);
        } else {
          addMessage({ role: 'assistant', content: `⚠️ ${errText}` }, effectiveSessionId);
        }
        set({ isLoading: false, streamingMessageId: null, streamingSessionId: null, error: errText, statusMessage: null, abortController: null });
      }
      return;
    }

    // 공통 AI 응답 파이프라인 위임
    await executeAiReply({
      effectiveSessionId,
      content,
      priorMessages,
      capturedAttachments,
    });
  };

  // ── replayMessage ────────────────────────────────────────────────────

  const replayMessage = async (messageId: string, targetSessionId?: string): Promise<void> => {
    // 동시 2개 스트리밍은 지원하지 않음: 진행 중이면 새 요청을 무시
    if (get().isLoading || get().abortController) {
      return;
    }

    const resolvedSessionId = targetSessionId ?? get().currentSessionId;
    const session = get().sessions.find((s) => s.id === resolvedSessionId);
    if (!session) return;

    const targetMessage = session.messages.find((m) => m.id === messageId);
    if (!targetMessage || targetMessage.role !== 'user') return;

    const content = targetMessage.content?.trim();
    if (!content) return;

    // 해당 메시지 "이전"까지의 히스토리 포함
    const maxRecent = getAiConfig().maxRecentMessages;
    const idx = session.messages.findIndex((m) => m.id === messageId);
    const priorMessages = idx > 0 ? session.messages.slice(Math.max(0, idx - maxRecent), idx) : [];

    // 재전송 시 해당 메시지 이후의 응답 삭제 (편집 후 저장과 동일한 동작)
    if (resolvedSessionId && idx >= 0) {
      const truncatedMessages = session.messages.slice(0, idx + 1);
      const updatedSession = { ...session, messages: truncatedMessages };
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === resolvedSessionId ? updatedSession : s)),
        streamingMessageId: null,
        streamingSessionId: null,
        ...(resolvedSessionId === state.currentSessionId
          ? { currentSession: updatedSession }
          : {}),
      }));
    }

    // 첨부 파일 캡처 후 즉시 초기화
    const capturedAttachments = get().composerAttachments;
    set({ composerAttachments: [] });

    // 공통 AI 응답 파이프라인 위임
    await executeAiReply({
      effectiveSessionId: resolvedSessionId!,
      content,
      priorMessages,
      capturedAttachments,
      extraCallbacks: {
        onModelRun: (step) => {
          if (step > 0) {
            set({ statusMessage: '결과 처리 및 답변 생성 중...' });
          } else {
            const isWeb = get().webSearchEnabled;
            set({ statusMessage: isWeb ? '답변 생성 및 웹 검색 확인 중...' : '답변 생성 및 도구 확인 중...' });
          }
        },
      },
      persistOnSuccess: true,
    });
  };

  return {
    sendMessage,
    replayMessage,
  };
}

// ── Streaming Actions ──────────────────────────────────────────────────

export function createStreamingActions(set: ChatSet, get: ChatGet) {
  const setStreamingContent = (content: string): void => {
    set({ streamingContent: content });
  };

  const setStreamingMetadata = (metadata: ChatMessage['metadata']): void => {
    set({ streamingMetadata: metadata });
  };

  /**
   * 스트리밍 내용을 메시지 배열에 커밋합니다.
   * @param assistantId 커밋 대상 placeholder id (호출자가 명시 전달 권장).
   *   L1: 현재 streamingMessageId와 다르면 다른 요청(새 스트림)의 상태이므로 커밋하지 않습니다.
   */
  const finalizeStreaming = (assistantId?: string): void => {
    const { streamingMessageId, streamingSessionId, streamingContent, streamingMetadata, isFinalizingStreaming } = get();
    if (!streamingMessageId) return;

    // L1: 소유권 가드. 명시된 assistantId가 현재 스트리밍 메시지가 아니면 스킵
    if (assistantId !== undefined && assistantId !== streamingMessageId) return;

    // Race Condition 방지: 이미 finalization 진행 중이면 스킵
    if (isFinalizingStreaming) return;

    // finalization 시작
    set({ isFinalizingStreaming: true });

    try {
      // 스트리밍 완료 후 한 번만 messages 배열에 반영
      if (streamingContent !== null) {
        // Issue #11 수정: toolCallsInProgress만 초기화하고 나머지 메타데이터는 보존
        const { toolCallsInProgress: _, ...preservedMetadata } = streamingMetadata ?? {};
        get().updateMessage(streamingMessageId, {
          content: streamingContent,
          metadata: { ...preservedMetadata, toolCallsInProgress: [] },
        }, streamingSessionId ?? undefined);
      }
    } finally {
      // 스트리밍 상태 초기화 (항상 실행 보장)
      set({
        streamingContent: null,
        streamingMetadata: null,
        streamingMessageId: null,
        streamingSessionId: null,
        isLoading: false,
        statusMessage: null,
        isFinalizingStreaming: false,
      });
    }
  };

  return {
    setStreamingContent,
    setStreamingMetadata,
    finalizeStreaming,
  };
}
