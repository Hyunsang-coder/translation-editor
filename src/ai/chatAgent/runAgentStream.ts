/**
 * 채팅 에이전트 실행 (LangChain v1 createAgent = LangGraph ReAct 그래프)
 *
 * 종전에는 손수 만든 도구 호출 루프가 스트리밍·도구 호출 파싱·메시지 누적을 모두
 * 처리했다. 이제 그래프가 그 골격을 맡고, 이 모듈은 두 가지만 담당한다.
 * 1) 그래프 조립 (모델/도구/미들웨어)
 * 2) 스트림 소비 → StreamCallbacks 발행 + usage 집계 + 최종 텍스트 결정
 */
import {
  contextEditingMiddleware,
  createAgent,
  modelCallLimitMiddleware,
  modelRetryMiddleware,
} from 'langchain';
import { AIMessageChunk, SystemMessage, trimMessages } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ClientTool, ServerTool } from '@langchain/core/tools';
import i18n from '@/i18n/config';
import { extractChunkContent } from '@/ai/extractChunkContent';
import { DEFAULT_CHAT_MAX_TOKENS } from '@/ai/constants';
import { computeInputBudget, estimateMessagesTokens } from '@/ai/chatContext/tokenBudget';
import { isRetryableError } from '@/ai/retry';
import type { ModelCapabilities } from '@/ai/chatContext/modelCapabilities';
import {
  createModelStepMiddleware,
  createPromptCacheMiddleware,
  createToolExecutionMiddleware,
} from './middleware';
import { ToolResultCompactionEdit } from './toolResultCompaction';
import type { StreamCallbacks, UsageInfo } from './types';

export { FINAL_STEP_NUDGE } from './middleware';

/** createAgent가 모델을 실행하는 그래프 노드 이름 */
const MODEL_NODE = 'model_request';

// run-level 호출 한도(모델 스텝 수) — context 크기 한도와 별개로 둔다.
const DEFAULT_MAX_MODEL_STEPS = 6;
const MAX_MODEL_STEPS_CAP = 12;

export interface RunChatAgentParams {
  model: BaseChatModel;
  /**
   * 모델에 바인딩할 도구 전체.
   * 로컬 실행 도구(ClientTool)와 provider 서버 실행 도구(ServerTool, 예: web_search)를
   * 함께 넘긴다. 그래프는 ClientTool만 도구 노드에서 실행한다.
   */
  tools: (ClientTool | ServerTool)[];
  systemPrompt: string | SystemMessage;
  /** 시스템 메시지를 제외한 대화 메시지 (이력 + 현재 사용자 입력) */
  messages: BaseMessage[];
  maxSteps?: number | undefined;
  /**
   * 실행 provider. 'anthropic'이면 매 스텝 요청에 cache_control breakpoint를 적용해
   * 반복 프리픽스를 prompt cache로 할인받는다 (OpenAI는 서버 자동 캐싱이라 불필요).
   */
  provider?: string | undefined;
  /** 입력 토큰 하드 가드용 모델 capability (없으면 가드를 건너뛴다) */
  capabilities?: ModelCapabilities | undefined;
  cb?: StreamCallbacks | undefined;
  abortSignal?: AbortSignal | undefined;
}

export interface RunChatAgentResult {
  finalText: string;
  usedTools: boolean;
  toolsUsed: string[];
  usage: UsageInfo;
}

/**
 * OpenAI Responses API built-in tools(web_search_preview 등)은 function tool_calls 형태로
 * 노출되지 않을 수 있어 message content blocks / annotations를 기반으로 "사용 흔적"을
 * 보수적으로 감지한다.
 */
function detectOpenAiBuiltInToolsFromMessage(
  ai: unknown,
  tools: (ClientTool | ServerTool)[],
): string[] {
  const hasWebSearchBound = tools.some(
    (t) => t && typeof t === 'object' && (t as Record<string, unknown>).type === 'web_search_preview',
  );
  if (!hasWebSearchBound) return [];

  const a = ai as Record<string, unknown>;
  const candidates: string[] = [];

  // 1) Standard content blocks (LangChain v1)
  const blocks = (a?.contentBlocks ?? a?.content_blocks) as unknown[] | undefined;
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      const s = typeof b === 'string' ? b : JSON.stringify(b);
      if (s.includes('web_search')) candidates.push('web_search_preview');
      if (s.includes('url_citation')) candidates.push('web_search_preview');
    }
  }

  // 2) Provider-native content (Responses API는 content가 block array인 경우가 많음)
  const content = a?.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object') {
        const co = c as Record<string, unknown>;
        const type = String(co.type ?? '');
        const annotations = co.annotations;
        if (type.includes('server_tool') || type.includes('tool_result') || type.includes('tool_call')) {
          const s = JSON.stringify(c);
          if (s.includes('web_search')) candidates.push('web_search_preview');
        }
        if (Array.isArray(annotations)) {
          const hasCitation = (annotations as Record<string, unknown>[]).some(
            (ann) =>
              String(ann?.type ?? '').includes('citation') ||
              JSON.stringify(ann).includes('url_citation'),
          );
          if (hasCitation) candidates.push('web_search_preview');
        }
      }
    }
  }

  // 3) additional_kwargs 등에도 provider별 metadata가 담길 수 있음
  const extra = (a?.additional_kwargs ?? a?.additionalKwargs ?? {}) as Record<string, unknown>;
  try {
    const s = JSON.stringify(extra);
    if (s.includes('web_search') || s.includes('url_citation')) candidates.push('web_search_preview');
  } catch {
    // ignore
  }

  return [...new Set(candidates)];
}

/**
 * 모델 호출 직전 입력 토큰 하드 가드.
 * 요약 + 최근 원문이 조립된 이후에도 예산을 넘으면 trimMessages로 최종 절단한다.
 * - 시스템 메시지는 보존(includeSystem), 최신(현재 사용자 메시지)부터 유지(strategy 'last').
 * - 예산 이내면 무손실로 그대로 반환한다.
 */
async function applyInputTokenGuard(
  messages: BaseMessage[],
  capabilities: ModelCapabilities,
): Promise<BaseMessage[]> {
  const budget = computeInputBudget({
    maxInputTokens: capabilities.maxInputTokens,
    outputTokenBudget: DEFAULT_CHAT_MAX_TOKENS,
  });
  if (estimateMessagesTokens(messages) <= budget.usableInputTokens) return messages;

  try {
    const trimmed = await trimMessages(messages, {
      maxTokens: budget.usableInputTokens,
      tokenCounter: estimateMessagesTokens,
      strategy: 'last',
      startOn: 'human',
      includeSystem: true,
    });
    if (Array.isArray(trimmed) && trimmed.length > 0) return trimmed;
    return messages;
  } catch (e) {
    console.warn(
      '[chat] input token guard(trimMessages) 실패, 원본 유지:',
      e instanceof Error ? e.message : e,
    );
    return messages;
  }
}

/**
 * 스텝 usage는 청크에서 직접 병합한다.
 * Anthropic 스트리밍은 message_start와 message_delta가 모두 "누적 스냅샷" usage를
 * 보고하는데, chunk concat은 usage_metadata를 필드별 합산하므로(@langchain/core
 * mergeInputTokenDetails) 캐시 read/write가 정확히 2배로 계상된다(input_tokens는
 * start에만 실려 무사). 누적 스냅샷끼리는 필드별 최댓값이 그 스텝의 실제값이다.
 */
interface StepUsage {
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheCreation?: number | undefined;
}

function maxField(a: number | undefined, b: number | undefined): number | undefined {
  return b === undefined ? a : a === undefined ? b : Math.max(a, b);
}

function collectStepUsage(acc: StepUsage, chunk: AIMessageChunk): void {
  const u = (
    chunk as unknown as {
      usage_metadata?: {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: { cache_read?: number; cache_creation?: number };
      };
    }
  ).usage_metadata;
  if (!u) return;
  acc.input = maxField(acc.input, u.input_tokens);
  acc.output = maxField(acc.output, u.output_tokens);
  // prompt caching 실효 관측 (Anthropic: cache_control, OpenAI: 자동 프리픽스 캐싱).
  // 0도 그대로 유지한다. undefined(=provider 미보고)와 0(=캐시 미스)은 원인이 달라
  // 구분되지 않으면 진단이 불가능하다.
  acc.cacheRead = maxField(acc.cacheRead, u.input_token_details?.cache_read);
  acc.cacheCreation = maxField(acc.cacheCreation, u.input_token_details?.cache_creation);
}

function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return true;
  const message = String((error as { message?: unknown }).message ?? '');
  return /\babort(ed)?\b/i.test(message);
}

function toAbortError(): Error {
  // chatStore의 isAbortError()는 name === 'AbortError'로 판별한다.
  // LangGraph는 취소 시 name이 'Error'인 일반 에러를 던지므로 여기서 정규화한다.
  return new DOMException('Request aborted', 'AbortError');
}

export async function runChatAgentStream(
  params: RunChatAgentParams,
): Promise<RunChatAgentResult> {
  const maxSteps = Math.max(
    1,
    Math.min(MAX_MODEL_STEPS_CAP, params.maxSteps ?? DEFAULT_MAX_MODEL_STEPS),
  );

  const systemMessage =
    params.systemPrompt instanceof SystemMessage
      ? params.systemPrompt
      : new SystemMessage(params.systemPrompt);

  // 입력 토큰 가드는 종전과 동일하게 실행 시작 시 1회만 적용한다.
  // (스텝마다 적용하면 tool_use ↔ tool_result 쌍이 잘릴 수 있다)
  let agentMessages = params.messages;
  if (params.capabilities) {
    const guarded = await applyInputTokenGuard(
      [systemMessage, ...params.messages],
      params.capabilities,
    );
    agentMessages = guarded.filter((m) => !(m instanceof SystemMessage));
  }

  const toolExec = createToolExecutionMiddleware({ cb: params.cb });

  const builtInToolsUsed: string[] = [];
  let stepText = '';
  let stepUsage: StepUsage = {};
  /** 스텝을 넘겨도 마지막으로 생성된 텍스트를 보존한다 */
  let lastEmittedText = '';
  /** 마지막 모델 스텝이 만든 텍스트 (도구 호출 없이 끝났을 때의 최종 답변) */
  let lastStepText = '';
  let endedWithoutToolCalls = false;

  const agent = createAgent({
    model: params.model,
    tools: params.tools,
    systemPrompt: systemMessage,
    middleware: [
      // 하드 스텝 상한. 초과 시 그래프를 종료한다(빌트인 안내 메시지는 노출하지 않고
      // 아래에서 마지막으로 생성된 텍스트 또는 i18n 안내로 대체한다).
      modelCallLimitMiddleware({ runLimit: maxSteps, exitBehavior: 'end' }),
      // 도구 위생 + 에러 반복/메시지 수 초과 조기 중단
      toolExec.middleware,
      // 오래되고 큰 도구 결과 축약
      contextEditingMiddleware({ edits: [new ToolResultCompactionEdit()] }),
      // 429/5xx/네트워크 오류 재시도 (판정 기준은 기존 withRetry와 동일).
      // 취소는 재시도하지 않는다.
      modelRetryMiddleware({
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30_000,
        backoffFactor: 2,
        jitter: true,
        retryOn: (error: Error) =>
          !isAbortLike(error, params.abortSignal) && isRetryableError(error),
      }),
      // 마지막 스텝 최종 답변 강제 + onModelRun. 재시도보다 안쪽이라 시도마다 실행되며,
      // 재시도 시 직전 시도가 흘린 부분 출력/usage를 폐기한다.
      createModelStepMiddleware({
        maxModelCalls: maxSteps,
        cb: params.cb,
        onAttemptStart: () => {
          stepText = '';
          stepUsage = {};
        },
      }),
      // prompt cache는 최종 메시지 목록을 봐야 하므로 가장 안쪽(배열 마지막)에 둔다.
      ...(params.provider === 'anthropic' ? [createPromptCacheMiddleware()] : []),
    ],
  });

  const usage: UsageInfo = {};
  const addUsage = (step: StepUsage): void => {
    if (step.input === undefined && step.output === undefined) return;
    usage.modelCalls = (usage.modelCalls ?? 0) + 1;
    if (step.input !== undefined) {
      usage.inputTokens = (usage.inputTokens ?? 0) + step.input;
      usage.lastInputTokens = step.input;
    }
    if (step.output !== undefined) usage.outputTokens = (usage.outputTokens ?? 0) + step.output;
    usage.totalTokens = (usage.totalTokens ?? 0) + (step.input ?? 0) + (step.output ?? 0);
    if (step.cacheRead !== undefined) {
      usage.cacheReadInputTokens = (usage.cacheReadInputTokens ?? 0) + step.cacheRead;
    }
    if (step.cacheCreation !== undefined) {
      usage.cacheCreationInputTokens = (usage.cacheCreationInputTokens ?? 0) + step.cacheCreation;
    }
  };

  const resolveFinalText = (): string => {
    const earlyExit = toolExec.getEarlyExitMessage();
    if (earlyExit !== null) return earlyExit;
    if (toolExec.isMessageLimitReached()) {
      return lastEmittedText || i18n.t('errors.conversationLengthLimit');
    }
    // 도구 호출 없이 끝난 스텝의 텍스트가 곧 최종 답변이다.
    if (endedWithoutToolCalls) return lastStepText;
    // 스텝 소진: 마지막으로 생성된 텍스트가 있으면 그것이 최종 답변이고,
    // 없을 때만 실제 상황(스텝 한도 도달)을 알리는 안내를 반환한다.
    return lastEmittedText || i18n.t('errors.toolLoopStepLimit');
  };

  const finish = (): RunChatAgentResult => {
    const toolsUsed = [...toolExec.getToolsUsed(), ...builtInToolsUsed];
    return {
      finalText: resolveFinalText(),
      usedTools: toolsUsed.length > 0,
      toolsUsed,
      usage,
    };
  };

  try {
    const stream = await agent.stream(
      { messages: agentMessages },
      {
        streamMode: ['messages', 'updates'],
        ...(params.abortSignal ? { signal: params.abortSignal } : {}),
        // 실질적인 상한은 modelCallLimit이 건다. 여기서는 미들웨어 노드까지 포함한
        // super-step 수가 그 전에 걸리지 않도록 넉넉히 잡는다.
        recursionLimit: maxSteps * 12 + 25,
      },
    );

    for await (const event of stream) {
      const [mode, payload] = event as [string, unknown];

      if (mode === 'messages') {
        const [chunk, meta] = payload as [AIMessageChunk, { langgraph_node?: string }];
        if (meta?.langgraph_node !== MODEL_NODE) continue;

        const delta = extractChunkContent(chunk);
        if (delta) {
          stepText += delta;
          params.cb?.onToken?.(stepText, delta);
        }
        collectStepUsage(stepUsage, chunk);
        continue;
      }

      if (mode !== 'updates') continue;
      const modelUpdate = (payload as Record<string, { messages?: BaseMessage[] } | undefined>)[
        MODEL_NODE
      ];
      if (!modelUpdate) continue;

      // 모델 노드 1회 완료 = 스텝 경계
      addUsage(stepUsage);
      stepUsage = {};

      if (stepText) lastEmittedText = stepText;
      lastStepText = stepText;
      stepText = '';

      const aiMessage = modelUpdate.messages?.[modelUpdate.messages.length - 1];
      const builtIns = detectOpenAiBuiltInToolsFromMessage(aiMessage, params.tools);
      for (const t of builtIns) {
        if (!builtInToolsUsed.includes(t)) builtInToolsUsed.push(t);
      }
      if (builtIns.length > 0) {
        console.warn('[AI builtin_tools_used]', builtIns);
      }

      const toolCalls = (aiMessage as { tool_calls?: unknown[] } | undefined)?.tool_calls;
      endedWithoutToolCalls = !Array.isArray(toolCalls) || toolCalls.length === 0;
    }
  } catch (e) {
    if (isAbortLike(e, params.abortSignal)) throw toAbortError();

    // 네트워크 에러 등 - 부분 응답이 있으면 반환
    if (stepText || lastEmittedText) {
      addUsage(stepUsage);
      lastEmittedText = stepText || lastEmittedText;
      endedWithoutToolCalls = false;
      return finish();
    }
    throw e;
  }

  return finish();
}
