/**
 * chatStore AI 상호작용 슬라이스 (executeAiReply, sendMessage, replayMessage, streaming)
 */
import type { ChatMessage } from '@/types';
import type { AttachmentDto } from '@/tauri/attachments';
import { streamAssistantReply, type StreamCallbacks } from '@/ai/chat';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { useProjectStore } from '@/stores/projectStore';
import { useConnectorStore } from '@/stores/connectorStore';
import { searchGlossary } from '@/tauri/glossary';
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

// ── AI Actions ─────────────────────────────────────────────────────────

export function createAiActions(
  set: ChatSet,
  get: ChatGet,
  helpers: { schedulePersist: () => void; persistNow: () => Promise<void> },
) {
  const { schedulePersist } = helpers;

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
    const abortController = new AbortController();
    set({ abortController, isLoading: true, error: null, streamingMessageId: null, statusMessage: '요청 분석 및 컨텍스트 확인 중...' });

    try {
      const cfg = getAiConfig();
      // fresh session 읽기 (caller가 truncation 등으로 변경했을 수 있음)
      const session = get().sessions.find((s) => s.id === effectiveSessionId) ?? null;
      const project = useProjectStore.getState().project;
      const translatorPersona = get().translatorPersona;
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

      // 로컬 글로서리 주입 (on-demand)
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
        // 글로서리 검색 실패는 조용히 무시 (모델 호출 UX 방해 최소화)
        set({ lastInjectedGlossary: [] });
      }

      const recent: ChatMessage[] = priorMessages;

      // Assistant 빈 메시지 추가 (스트리밍 버블)
      const assistantId = get().addMessage({
        role: 'assistant',
        content: '',
        metadata: { model: cfg.model, toolCallsInProgress: [] },
      }, effectiveSessionId);
      if (assistantId) {
        set({ streamingMessageId: assistantId, streamingSessionId: effectiveSessionId });
      }

      // 기본 콜백 + extraCallbacks 머지
      const callbacks: StreamCallbacks = {
        onToken: (full) => {
          if (get().statusMessage !== '답변 생성 중...') {
            set({ statusMessage: '답변 생성 중...' });
          }
          set({ streamingContent: restoreGhostChips(full, maskSession) });
        },
        onToolCall: (evt) => {
          if (!assistantId) return;
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
          const currentMetadata = get().streamingMetadata ?? {};
          set({
            streamingMetadata: { ...currentMetadata, toolsUsed },
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
          translatorPersona,
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
        callbacks,
      );

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
        get().finalizeStreaming();
      }

      set({ abortController: null });
      if (persistOnSuccess) {
        schedulePersist();
      }
    } catch (error) {
      // AbortError는 정상적인 취소이므로 에러로 표시하지 않음
      if (error instanceof Error && error.name === 'AbortError') {
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

      const assistantId = get().streamingMessageId;
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
      : get().currentSessionId!;

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

      set({ isLoading: true, error: null, statusMessage: '웹 검색 준비 중...' });

      const cfg = getAiConfig();
      const initialToolsInProgress = cfg.provider === 'openai' ? ['web_search_preview'] : ['web_search'];

      const assistantId = addMessage({
        role: 'assistant',
        content: '',
        metadata: { model: 'web_search', toolCallsInProgress: initialToolsInProgress, toolsUsed: [] },
      }, effectiveSessionId);

      try {
        let text = '';
        const toolsUsed: string[] = [];

        const modelAny = createChatModel(undefined, { useFor: 'chat' }) as any;

        if (cfg.provider === 'openai') {
          set({ statusMessage: 'OpenAI 웹 검색 중...' });
          const modelWithSearch =
            typeof modelAny.bindTools === 'function'
              ? modelAny.bindTools([{ type: 'web_search_preview' }])
              : modelAny;

          const ai = await modelWithSearch.invoke(
            [
              '웹 검색을 수행한 뒤, 아래 형식으로 간결하게 정리해 주세요.',
              '',
              `- 질문: ${webQuery}`,
              '- 출력:',
              '  1) 요약(3~6줄)',
              '  2) 근거 링크 3~8개 (가능하면 제목 + 링크)',
            ].join('\n'),
          );
          text = extractTextFromAiMessage(ai);
          if (text.trim()) toolsUsed.push('web_search_preview');
        } else if (cfg.provider === 'anthropic') {
          set({ statusMessage: 'Anthropic 웹 검색 중...' });
          const modelWithSearch =
            typeof modelAny.bindTools === 'function'
              ? modelAny.bindTools([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }])
              : modelAny;

          const ai = await modelWithSearch.invoke(
            [
              '웹 검색을 수행한 뒤, 아래 형식으로 간결하게 정리해 주세요.',
              '',
              `- 질문: ${webQuery}`,
              '- 출력:',
              '  1) 요약(3~6줄)',
              '  2) 근거 링크 3~8개 (가능하면 제목 + 링크)',
            ].join('\n'),
          );
          text = extractTextFromAiMessage(ai);
          if (text.trim()) toolsUsed.push('web_search');
        }

        if (assistantId) {
          updateMessage(assistantId, { content: text, metadata: { toolCallsInProgress: [], toolsUsed } }, effectiveSessionId);
        } else {
          addMessage({ role: 'assistant', content: text }, effectiveSessionId);
        }
        set({ isLoading: false, streamingMessageId: null, streamingSessionId: null, error: null, statusMessage: null });
        schedulePersist();
      } catch (e) {
        const errText = e instanceof Error ? e.message : '웹 검색 실패';
        if (assistantId) {
          updateMessage(assistantId, { content: `⚠️ ${errText}`, metadata: { toolCallsInProgress: [] } }, effectiveSessionId);
        } else {
          addMessage({ role: 'assistant', content: `⚠️ ${errText}` }, effectiveSessionId);
        }
        set({ isLoading: false, streamingMessageId: null, streamingSessionId: null, error: errText, statusMessage: null });
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

  const finalizeStreaming = (): void => {
    const { streamingMessageId, streamingSessionId, streamingContent, streamingMetadata, isFinalizingStreaming } = get();
    if (!streamingMessageId) return;

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
