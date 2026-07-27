/**
 * chatStore AI 상호작용 슬라이스 (executeAiReply, sendMessage, replayMessage, streaming)
 */
import type {
  ChatContextMode,
  ChatMessage,
  ChatSelectionSnapshot,
  ContextManifest,
  ForbiddenTermProposal,
  GlossaryEntryProposal,
  ProjectMemoryCategory,
  ProjectMemoryChangeProposal,
  SelectionContext,
  SendMessageOptions,
} from '@/types';
import type { AttachmentDto } from '@/tauri/attachments';
import { streamAssistantReply, type StreamCallbacks } from '@/ai/chat';
import { resolveModelRunConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { resolveModelCapabilities } from '@/ai/chatContext/modelCapabilities';
import { approxTokens, computeInputBudget } from '@/ai/chatContext/tokenBudget';
import { planConversationContext } from '@/ai/chatContext/conversationContext';
import {
  summarizeConversation,
  resolveSummaryModelRunConfig,
} from '@/ai/chatContext/summarizeConversation';
import { DEFAULT_CHAT_MAX_TOKENS } from '@/ai/constants';
import { useProjectStore } from '@/stores/projectStore';
import { useConnectorStore } from '@/stores/connectorStore';
import { formatGlossaryForPrompt, resolveGlossaryEntries } from '@/utils/glossaryInject';
import {
  createGhostMaskSession,
  maskGhostChips,
  restoreGhostChips,
} from '@/utils/ghostMask';
import { cleanSuggestionContent } from '@/utils/cleanSuggestionContent';
import { hashContent, stripHtml } from '@/utils/hash';
import type { ChatSet, ChatGet } from './chatStore.types';
import i18n from '@/i18n/config';
import {
  getChatToolDescriptor,
  getChatToolDisplayNameKey,
} from '@/ai/tools/toolRegistry';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { renderChatMemoryDigest } from '@/ai/context/projectKnowledgeRender';
import {
  appendProposal,
  tryExtractWebSearchQuery,
  extractTextFromAiMessage,
  inferSuggestionFromAssistantText,
  createIncrementalGhostRestorer,
} from './chatStore.helpers';
import {
  filterMessagesForSelectionScope,
  toChatSelectionSnapshot,
} from '@/ai/chatContext/selectionContext';
import { v4 as uuidv4 } from 'uuid';

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
  contextMode?: ChatContextMode;
  selection?: ChatSelectionSnapshot;
  selectionContext?: SelectionContext;
  selectionScopeId?: string;
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
      contextMode = 'general',
      selection,
      selectionContext,
      selectionScopeId,
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
      const isSelectionRequest = contextMode === 'selection' && !!selectionScopeId;
      // 요청 실행 설정을 한 번만 캡처: 이후 전역/세션 모델이 바뀌어도 이 요청의 모델은 고정된다.
      // (세션별 modelPreset이 있으면 그것을, 없으면 전역 chat 기본값을 사용)
      const runConfig = resolveModelRunConfig({ ...(session?.modelPreset ? { preset: session.modelPreset } : {}) });
      const project = useProjectStore.getState().project;
      const webSearchEnabled = get().webSearchEnabled;

      const contextBlockIds = session?.contextBlockIds ?? [];
      const contextBlocks =
        project && !isSelectionRequest
          ? contextBlockIds
            .map((id) => project.blocks[id])
            .filter((b): b is NonNullable<typeof b> => b !== undefined)
          : [];
      const translationRulesRaw = isSelectionRequest ? '' : get().translationRules;

      const translationRules = translationRulesRaw
        ? maskGhostChips(translationRulesRaw, maskSession)
        : '';

      // 승인된 Project Memory/금칙어는 압축 요약으로만 주입한다(매 턴 반복되므로).
      // 요약에 없는 상세는 모델이 get_project_guidance로 조회한다.
      const memoryState = useProjectMemoryStore.getState();
      const memoryDigest = isSelectionRequest
        ? null
        : renderChatMemoryDigest({
          items: memoryState.items,
          forbiddenTerms: memoryState.forbiddenTerms,
        });
      const projectMemoryDigest = memoryDigest?.projectMemory
        ? maskGhostChips(memoryDigest.projectMemory, maskSession)
        : '';
      const forbiddenTermsDigest = memoryDigest?.forbiddenTerms
        ? maskGhostChips(memoryDigest.forbiddenTerms, maskSession)
        : '';

      // 로컬 글로서리 주입 (on-demand, 문서 전역 윈도우)
      let glossaryInjected = '';
      try {
        if (project?.id && !isSelectionRequest) {
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

      // ── Phase 3: 장기 대화 context planning + 증분 요약 ──────────────
      // 전체 prior transcript(priorMessages)를 토큰 예산 기준으로 "누적 요약 + 최근 원문"으로 나눈다.
      // 예산을 넘는 오래된 구간만 저비용 모델로 요약해 세션 memory에 저장한다(transcript 무손실).
      const capabilities = resolveModelCapabilities(runConfig);
      const budget = computeInputBudget({
        maxInputTokens: capabilities.maxInputTokens,
        outputTokenBudget: DEFAULT_CHAT_MAX_TOKENS,
      });
      // 시스템 프롬프트/도구 가이드 + 규칙/글로서리/컨텍스트/현재 입력의 고정 컨텍스트 추정치
      const SYSTEM_BASE_TOKENS = 1_500;
      const reservedContextTokens =
        SYSTEM_BASE_TOKENS +
        approxTokens(translationRules) +
        approxTokens(projectMemoryDigest) +
        approxTokens(forbiddenTermsDigest) +
        approxTokens(glossaryInjected) +
        approxTokens(content);

      const plan = isSelectionRequest
        ? {
            recentRawMessages: priorMessages.slice(-12),
            needsSummary: false,
            messagesToSummarize: [],
            summarizedThroughMessageId: null,
          }
        : planConversationContext({
            messages: priorMessages,
            memory: session?.memory,
            budget,
            reservedContextTokens,
          });

      let conversationSummary = isSelectionRequest ? '' : (session?.memory?.summary ?? '');
      if (plan.needsSummary) {
        set({ statusMessage: '이전 대화 요약 중...' });
        try {
          const newSummary = await summarizeConversation({
            priorSummary: conversationSummary,
            messagesToSummarize: plan.messagesToSummarize,
            runConfig,
            abortSignal: abortController.signal,
          });
          // 요약 도중 취소/전환됐으면 이 요청의 상태를 더 진행하지 않는다.
          if (!ownsStream()) return;
          conversationSummary = newSummary;
          get().updateSessionMemory(effectiveSessionId, {
            summary: newSummary,
            summarizedThroughMessageId: plan.summarizedThroughMessageId,
            summaryUpdatedAt: Date.now(),
            summaryModel: resolveSummaryModelRunConfig(runConfig).resolvedModel,
            summaryVersion: 1,
          });
        } catch (e) {
          // abort는 상위 catch가 정리하도록 전파. 그 외 실패는 기존 요약으로 안전 진행(무손실).
          if (isAbortError(e)) throw e;
          console.warn(
            '[chatStore] 대화 요약 실패, 기존 요약으로 진행:',
            e instanceof Error ? e.message : e,
          );
        }
      }

      const recent: ChatMessage[] = plan.recentRawMessages;
      const initialIncluded: ContextManifest['included'] = [];
      if (selection) initialIncluded.push('selection');
      if (translationRules) initialIncluded.push('translation-rules');
      if (projectMemoryDigest) initialIncluded.push('project-memory');
      if (forbiddenTermsDigest) initialIncluded.push('forbidden-terms');
      if (glossaryInjected) initialIncluded.push('glossary');
      if (conversationSummary) initialIncluded.push('chat-summary');
      if (contextBlocks.length > 0) initialIncluded.push('document-tool');
      const contextManifest: ContextManifest = {
        mode: isSelectionRequest ? 'selection-chat' : 'general-chat',
        revision: memoryState.revision,
        projectMemoryItemIds: memoryDigest?.itemIds ?? [],
        ...(translationRules
          ? { translationRulesHash: hashContent(translationRules) }
          : {}),
        forbiddenTermIds: memoryDigest?.forbiddenTermIds ?? [],
        glossaryEntryIds: get().lastInjectedGlossary.map((entry) => entry.id),
        included: initialIncluded,
        estimatedInputTokens: reservedContextTokens,
      };

      // Assistant 빈 메시지 추가 (스트리밍 버블)
      // 실행 출처 메타데이터를 캡처된 runConfig에서 만든다(기록 모델 = 실제 호출 모델 보장).
      const initialAssistantMetadata: NonNullable<ChatMessage['metadata']> = {
        requestedModelPreset: runConfig.requestedPreset,
        resolvedModel: runConfig.resolvedModel,
        provider: runConfig.provider === 'mock' ? 'openai' : runConfig.provider,
        ...(runConfig.reasoningEffort ? { reasoningEffort: runConfig.reasoningEffort } : {}),
        ...(selectionScopeId ? { selectionScopeId } : {}),
        ...(selection ? { selection } : {}),
        contextManifest,
        toolCallsInProgress: [],
      };
      assistantId = get().addMessage({
        role: 'assistant',
        content: '',
        metadata: initialAssistantMetadata,
      }, effectiveSessionId);
      if (assistantId) {
        set({
          streamingMessageId: assistantId,
          streamingSessionId: effectiveSessionId,
          streamingMetadata: initialAssistantMetadata,
        });
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
          let nextMetadata = { ...currentMetadata };

          if (evt.phase === 'start') {
            const displayNameKey = getChatToolDisplayNameKey(evt.toolName);
            const friendlyName = displayNameKey
              ? i18n.t(displayNameKey)
              : evt.toolName;
            set({ statusMessage: `${friendlyName} 진행 중...` });
          } else {
            set({ statusMessage: '결과 처리 및 답변 생성 중...' });
            if (evt.status === 'success' && evt.result) {
              try {
                const parsed = JSON.parse(evt.result) as {
                  projectMemory?: Array<{ id?: unknown }>;
                  forbiddenTerms?: Array<{ id?: unknown }>;
                  entries?: Array<{ id?: unknown }>;
                };
                const manifest = nextMetadata.contextManifest ?? contextManifest;
                const included = new Set(manifest.included);
                const memoryIds = (parsed.projectMemory ?? [])
                  .map((item) => item.id)
                  .filter((id): id is string => typeof id === 'string');
                const forbiddenIds = (parsed.forbiddenTerms ?? [])
                  .map((item) => item.id)
                  .filter((id): id is string => typeof id === 'string');
                const glossaryIds = (parsed.entries ?? [])
                  .map((item) => item.id)
                  .filter((id): id is string => typeof id === 'string');
                if (memoryIds.length > 0) included.add('project-memory');
                if (forbiddenIds.length > 0) included.add('forbidden-terms');
                if (glossaryIds.length > 0) included.add('glossary');
                nextMetadata = {
                  ...nextMetadata,
                  contextManifest: {
                    ...manifest,
                    projectMemoryItemIds: [
                      ...new Set([...manifest.projectMemoryItemIds, ...memoryIds]),
                    ],
                    forbiddenTermIds: [
                      ...new Set([...manifest.forbiddenTermIds, ...forbiddenIds]),
                    ],
                    glossaryEntryIds: [
                      ...new Set([...manifest.glossaryEntryIds, ...glossaryIds]),
                    ],
                    included: [...included],
                  },
                };
              } catch {
                // JSON 구조를 반환하지 않는 도구는 type-level 사용 기록만 남긴다.
              }
            }
          }

          // 1. Tool Call Badge (Running state)
          const prev = currentMetadata.toolCallsInProgress ?? [];
          const next =
            evt.phase === 'start'
              ? prev.includes(evt.toolName) ? prev : [...prev, evt.toolName]
              : prev.filter((n) => n !== evt.toolName);

          // 2. Suggestion Handling (Smart Buttons)
          if (evt.phase === 'start' && evt.args) {
            if (
              evt.toolName === 'propose_selection_edit' &&
              selectionContext?.panel === 'target' &&
              evt.args.replacementText
            ) {
              nextMetadata = {
                ...nextMetadata,
                documentEditProposal: {
                  proposalId: uuidv4(),
                  selectionId: selectionContext.selectionId,
                  selectionScopeId: selectionContext.selectionScopeId,
                  projectId: selectionContext.projectId,
                  panel: 'target',
                  anchorId: selectionContext.anchorId,
                  originalText: selectionContext.text,
                  replacementText: String(evt.args.replacementText),
                  ...(evt.args.explanation
                    ? { explanation: String(evt.args.explanation) }
                    : {}),
                  operation:
                    evt.args.operation === 'translate' ||
                    evt.args.operation === 'polish'
                      ? evt.args.operation
                      : 'rewrite',
                  documentRevisionAtRequest: selectionContext.documentRevision,
                  contextManifest: currentMetadata.contextManifest ?? contextManifest,
                  status: 'proposed',
                  createdAt: Date.now(),
                },
              };
            } else if (
              evt.toolName === 'propose_project_memory_change' &&
              typeof evt.args.operation === 'string' &&
              typeof evt.args.category === 'string'
            ) {
              const operation =
                evt.args.operation === 'replace' || evt.args.operation === 'archive'
                  ? evt.args.operation
                  : 'add';
              const proposal: ProjectMemoryChangeProposal = {
                proposalId: uuidv4(),
                operation,
                category: evt.args.category as ProjectMemoryCategory,
                ...(evt.args.content ? { content: String(evt.args.content) } : {}),
                ...(evt.args.targetItemId
                  ? { targetItemId: String(evt.args.targetItemId) }
                  : {}),
                ...(evt.args.reason ? { reason: String(evt.args.reason) } : {}),
                sourceSessionId: effectiveSessionId,
                ...(assistantId ? { sourceMessageId: assistantId } : {}),
                status: 'proposed',
              };
              nextMetadata = {
                ...nextMetadata,
                projectMemoryProposals: appendProposal(
                  nextMetadata.projectMemoryProposals,
                  proposal,
                  (candidate) =>
                    candidate.operation === proposal.operation
                    && candidate.category === proposal.category
                    && candidate.content === proposal.content
                    && candidate.targetItemId === proposal.targetItemId,
                ),
              };
            } else if (evt.toolName === 'suggest_forbidden_term' && evt.args.term) {
              const proposal: ForbiddenTermProposal = {
                proposalId: uuidv4(),
                term: String(evt.args.term),
                ...(evt.args.replacement
                  ? { replacement: String(evt.args.replacement) }
                  : {}),
                ...(evt.args.note ? { note: String(evt.args.note) } : {}),
                status: 'proposed',
              };
              nextMetadata = {
                ...nextMetadata,
                forbiddenTermProposals: appendProposal(
                  nextMetadata.forbiddenTermProposals,
                  proposal,
                  (candidate) =>
                    candidate.term === proposal.term
                    && candidate.replacement === proposal.replacement,
                ),
              };
            } else if (
              evt.toolName === 'suggest_glossary_entry' &&
              evt.args.source &&
              evt.args.target
            ) {
              const proposal: GlossaryEntryProposal = {
                proposalId: uuidv4(),
                source: String(evt.args.source),
                target: String(evt.args.target),
                ...(evt.args.notes ? { notes: String(evt.args.notes) } : {}),
                status: 'proposed',
              };
              nextMetadata = {
                ...nextMetadata,
                glossaryEntryProposals: appendProposal(
                  nextMetadata.glossaryEntryProposals,
                  proposal,
                  (candidate) =>
                    candidate.source === proposal.source
                    && candidate.target === proposal.target,
                ),
              };
            } else if (evt.toolName === 'suggest_translation_rule' && evt.args.rule) {
              const prev = nextMetadata.suggestedRule ?? '';
              const cleaned = cleanSuggestionContent(String(evt.args.rule));
              nextMetadata = {
                ...nextMetadata,
                suggestedRule: prev ? `${prev}; ${cleaned}` : cleaned,
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
          const manifest = currentMetadata.contextManifest ?? contextManifest;
          const included = new Set(manifest.included);
          if (toolsUsed.includes('get_aligned_selection_context')) included.add('aligned-source');
          if (toolsUsed.some((name) =>
            ['get_source_document', 'get_target_document', 'get_selection_surroundings', 'get_review_results']
              .includes(name),
          )) included.add('document-tool');
          if (toolsUsed.some((name) => getChatToolDescriptor(name)?.trust === 'external')) {
            included.add('external-tool');
          }
          if (toolsUsed.includes('get_project_guidance')) included.add('project-memory');
          const documentEditProposal = currentMetadata.documentEditProposal
            ? {
                ...currentMetadata.documentEditProposal,
                contextManifest: {
                  ...manifest,
                  included: [...included],
                },
              }
            : undefined;
          set({
            streamingMetadata: {
              ...currentMetadata,
              toolsUsed,
              contextManifest: {
                ...manifest,
                included: [...included],
              },
              ...(documentEditProposal ? { documentEditProposal } : {}),
            },
          });
        },
        onUsage: (usage) => {
          if (!ownsStream()) return;
          const currentMetadata = get().streamingMetadata ?? {};
          // Phase 4: 실제 provider 입력 토큰 기준 context 사용률 (사전 추정과 분리, §12.5)
          const contextUtilization =
            usage.inputTokens !== undefined && capabilities.maxInputTokens > 0
              ? Math.min(1, usage.inputTokens / capabilities.maxInputTokens)
              : undefined;
          set({
            streamingMetadata: {
              ...currentMetadata,
              ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
              ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
              ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
              ...(contextUtilization !== undefined ? { contextUtilization } : {}),
              contextManifest: {
                ...(currentMetadata.contextManifest ?? contextManifest),
                ...(usage.inputTokens !== undefined
                  ? { estimatedInputTokens: usage.inputTokens }
                  : {}),
              },
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
          ...(selection ? { selection } : {}),
          ...(selectionContext?.status === 'active'
            ? { selectionProposalEnabled: true }
            : {}),
          translationRules,
          ...(projectMemoryDigest ? { projectMemoryDigest } : {}),
          ...(forbiddenTermsDigest ? { forbiddenTermsDigest } : {}),
          ...(glossaryInjected ? { glossaryInjected } : {}),
          ...(conversationSummary ? { conversationSummary } : {}),
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
        if (!currentMetadata.suggestedRule) {
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

  const sendMessage = async (
    content: string,
    targetSessionIdOrOptions?: string | SendMessageOptions,
  ): Promise<void> => {
    const options: SendMessageOptions =
      typeof targetSessionIdOrOptions === 'string'
        ? { targetSessionId: targetSessionIdOrOptions }
        : (targetSessionIdOrOptions ?? {});
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

    const resolvedSessionId = options.targetSessionId ?? get().currentSessionId;
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

    // Phase 3: 전체 prior transcript를 전달하고, 토큰 예산/요약은 executeAiReply의
    // context planner가 처리한다(고정 20개 slice 제거).
    const targetSession = get().sessions.find((s) => s.id === effectiveSessionId);
    const selectionScopeId = options.selectionScopeId ?? options.selection?.selectionScopeId;
    const priorMessages = selectionScopeId
      ? filterMessagesForSelectionScope(targetSession?.messages ?? [], selectionScopeId)
      : (targetSession?.messages ?? []);

    // 전송 시작 시점에 첨부 파일 캡처 후 즉시 초기화 (입력창 썸네일 즉시 제거)
    const capturedAttachments = get().composerAttachments;
    set({ composerAttachments: [] });

    // 사용자 메시지에 이미지 정보 포함 (채팅 UI 표시용)
    const imageAttachmentsForMessage = capturedAttachments
      .filter((a) => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(a.fileType.toLowerCase()) && a.thumbnailDataUrl)
      .map((a) => ({ filename: a.filename, thumbnailDataUrl: a.thumbnailDataUrl! }));

    const selectionSnapshot = options.selection
      ? toChatSelectionSnapshot(options.selection)
      : undefined;
    addMessage({
      role: 'user',
      content,
      ...(
        imageAttachmentsForMessage.length > 0 || selectionSnapshot || selectionScopeId
          ? {
              metadata: {
                ...(imageAttachmentsForMessage.length > 0
                  ? { imageAttachments: imageAttachmentsForMessage }
                  : {}),
                ...(selectionSnapshot ? { selection: selectionSnapshot } : {}),
                ...(selectionScopeId ? { selectionScopeId } : {}),
              },
            }
          : {}
      ),
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
      contextMode: options.contextMode ?? (selectionSnapshot ? 'selection' : 'general'),
      ...(selectionSnapshot ? { selection: selectionSnapshot } : {}),
      ...(options.selection ? { selectionContext: options.selection } : {}),
      ...(selectionScopeId ? { selectionScopeId } : {}),
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

    // 해당 메시지 "이전"까지의 전체 히스토리 포함 (Phase 3: context planner가 예산 처리)
    const idx = session.messages.findIndex((m) => m.id === messageId);
    const priorMessages = idx > 0 ? session.messages.slice(0, idx) : [];
    const selectionScopeId = targetMessage.metadata?.selectionScopeId;
    const scopedPriorMessages = selectionScopeId
      ? filterMessagesForSelectionScope(priorMessages, selectionScopeId)
      : priorMessages;

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
      priorMessages: scopedPriorMessages,
      capturedAttachments,
      contextMode: selectionScopeId ? 'selection' : 'general',
      ...(targetMessage.metadata?.selection
        ? { selection: targetMessage.metadata.selection }
        : {}),
      ...(selectionScopeId ? { selectionScopeId } : {}),
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
