import type { AiConfig } from '@/ai/config';
import { resolveModelCallOptions, type ModelUseFor } from '@/ai/modelCallOptions';
import { aiComplete, aiStream, aiStreamCancel, type AiCompletionMessage } from '@/tauri/ai';
import { recordAiUsage, type AiUsageFeature } from '@/ai/usageLedger';
import { isTauriRuntime } from '@/tauri/invoke';

export type AiPromptMessage = AiCompletionMessage;

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || /취소되었습니다/.test(error.message);
}

/** provider가 실제 HTTP 응답(4xx/5xx)을 반환한 경우. 백엔드로 재시도해도 동일하므로 제외. */
function hasHttpStatus(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; response?: { status?: unknown } };
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.response?.status === 'number'
        ? e.response.status
        : undefined;
  return typeof status === 'number' && status >= 400;
}

/**
 * WebView fetch의 네트워크/CORS 실패를 식별한다.
 * - fetch 실패는 사양상 TypeError로 거부된다("Type error", "Load failed",
 *   "Failed to fetch", "The network connection was lost." 등).
 * - LangChain/OpenAI/Anthropic SDK는 이를 APIConnectionError 등으로 감싸기도 한다.
 * 메시지/이름이 환경마다 달라 둘 다(원본 + cause 체인) 확인한다.
 */
function isNetworkLikeError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const identifiers = `${current.name} ${current.constructor?.name ?? ''}`.toLowerCase();
    const message = current.message.toLowerCase();
    if (
      identifiers.includes('typeerror') ||
      identifiers.includes('connection') ||
      message.includes('type error') ||
      message.includes('failed to fetch') ||
      message.includes('fetch failed') ||
      message.includes('load failed') ||
      message.includes('network') ||
      message.includes('connection error')
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function shouldRetryWithTauriAiBackend(error: unknown): boolean {
  if (!isTauriRuntime()) return false;
  if (isAbortError(error)) return false;
  // 인증/요청 오류 등 실제 provider 응답은 백엔드로 재시도해도 동일하므로 제외
  if (hasHttpStatus(error)) return false;
  return isNetworkLikeError(error);
}

function getProviderApiKey(cfg: AiConfig): string | undefined {
  if (cfg.provider === 'anthropic') return cfg.anthropicApiKey;
  if (cfg.provider === 'openai') return cfg.openaiApiKey;
  return undefined;
}

/**
 * 백엔드(Rust) aiComplete/aiStream에 넘길 모델별 호출 옵션.
 * createChatModel과 동일한 modelCallOptions 소스를 공유해 두 경로가 어긋나지 않는다.
 * (F7: thinking/effort 전달, F8: Sonnet 5 temperature 400 방지,
 *  A3: effort의 모델 지원 가드도 resolveModelCallOptions가 담당하므로 여기서는 그대로 전달)
 */
function getModelCallArgs(
  cfg: AiConfig,
  useFor: ModelUseFor,
): { temperature?: number; adaptiveThinking?: boolean; effort?: string } {
  const opts = resolveModelCallOptions(cfg, useFor);
  return {
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.adaptiveThinking ? { adaptiveThinking: true } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
  };
}

function createAbortPromise(
  abortSignal: AbortSignal,
  cancelMessage: string,
  onAbort?: () => void,
): { promise: Promise<never>; cleanup: () => void } {
  let cleanup: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    const handleAbort = () => {
      onAbort?.();
      reject(new Error(cancelMessage));
    };
    if (abortSignal.aborted) {
      handleAbort();
      return;
    }
    abortSignal.addEventListener('abort', handleAbort, { once: true });
    cleanup = () => abortSignal.removeEventListener('abort', handleAbort);
  });
  return { promise, cleanup };
}

export async function completeWithTauriAiBackend(params: {
  cfg: AiConfig;
  messages: AiPromptMessage[];
  maxTokens: number;
  useFor?: ModelUseFor | undefined;
  cancelMessage?: string | undefined;
  abortSignal?: AbortSignal | undefined;
  /** 사용량 장부에 남길 기능 구분. 생략하면 기록하지 않는다. */
  usageFeature?: AiUsageFeature | undefined;
  /** Anthropic: 같은 system을 재사용하는 반복 호출이면 true (prompt caching) */
  cacheSystem?: boolean | undefined;
}): Promise<string> {
  const cancelMessage = params.cancelMessage ?? '번역이 취소되었습니다.';
  const useFor = params.useFor ?? 'translation';

  // 사용자가 취소할 수 있는 Tauri 요청은 Rust의 cancellable streaming command로 통일한다.
  if (params.abortSignal) {
    return await streamWithTauriAiBackend({
      cfg: params.cfg,
      messages: params.messages,
      maxTokens: params.maxTokens,
      useFor,
      cancelMessage,
      abortSignal: params.abortSignal,
      usageFeature: params.usageFeature,
      cacheSystem: params.cacheSystem,
    });
  }

  if (params.cfg.provider === 'mock') {
    throw new Error('Mock provider는 더 이상 지원되지 않습니다. API 키를 설정해주세요.');
  }

  const apiKey = getProviderApiKey(params.cfg);
  if (!apiKey) {
    throw new Error(params.cfg.provider === 'anthropic'
      ? 'Anthropic API 키가 설정되어 있지 않습니다.'
      : 'OpenAI API 키가 설정되어 있지 않습니다.');
  }

  const response = await aiComplete({
    provider: params.cfg.provider,
    apiKey,
    model: params.cfg.model,
    maxTokens: params.maxTokens,
    messages: params.messages,
    ...getModelCallArgs(params.cfg, useFor),
    ...(params.cacheSystem ? { cacheSystem: true } : {}),
  });

  if (params.usageFeature && response.usage) {
    recordAiUsage({
      feature: params.usageFeature,
      provider: params.cfg.provider,
      model: params.cfg.model,
      ...response.usage,
    });
  }

  return response.text;
}

function generateStreamId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 백엔드 SSE 스트리밍으로 완성 텍스트를 받는다.
 * - onAccumulated: 지금까지 누적된 raw 텍스트(마커 포함)를 매 델타마다 전달
 * - 취소 시 백엔드에 cancel 신호를 보내고 cancelMessage로 reject
 */
export async function streamWithTauriAiBackend(params: {
  cfg: AiConfig;
  messages: AiPromptMessage[];
  maxTokens: number;
  useFor?: ModelUseFor | undefined;
  onAccumulated?: ((rawSoFar: string) => void) | undefined;
  cancelMessage?: string | undefined;
  abortSignal?: AbortSignal | undefined;
  /** 사용량 장부에 남길 기능 구분. 생략하면 기록하지 않는다. */
  usageFeature?: AiUsageFeature | undefined;
  /** Anthropic: 같은 system을 재사용하는 반복 호출이면 true (prompt caching) */
  cacheSystem?: boolean | undefined;
}): Promise<string> {
  const cancelMessage = params.cancelMessage ?? '번역이 취소되었습니다.';
  const useFor = params.useFor ?? 'translation';
  if (params.abortSignal?.aborted) {
    throw new Error(cancelMessage);
  }
  if (params.cfg.provider === 'mock') {
    throw new Error('Mock provider는 더 이상 지원되지 않습니다. API 키를 설정해주세요.');
  }

  const apiKey = getProviderApiKey(params.cfg);
  if (!apiKey) {
    throw new Error(params.cfg.provider === 'anthropic'
      ? 'Anthropic API 키가 설정되어 있지 않습니다.'
      : 'OpenAI API 키가 설정되어 있지 않습니다.');
  }

  const streamId = generateStreamId();
  let accumulated = '';
  let stopped = false;

  const invokePromise = aiStream(
    {
      streamId,
      provider: params.cfg.provider,
      apiKey,
      model: params.cfg.model,
      maxTokens: params.maxTokens,
      messages: params.messages,
      ...getModelCallArgs(params.cfg, useFor),
      ...(params.cacheSystem ? { cacheSystem: true } : {}),
    },
    (event) => {
      // usage는 stopped 가드보다 먼저 본다. 취소된 스트림도 생성분만큼 과금되고,
      // 백엔드는 취소 경로에서도 usage를 발행하기 때문이다.
      if (event.type === 'usage') {
        if (params.usageFeature) {
          recordAiUsage({
            feature: params.usageFeature,
            provider: params.cfg.provider,
            model: params.cfg.model,
            ...event.usage,
          });
        }
        return;
      }
      if (stopped) return;
      if (event.type === 'delta') {
        accumulated += event.text;
        params.onAccumulated?.(accumulated);
      }
    },
  );

  const abortSignal = params.abortSignal;
  if (!abortSignal) {
    const res = await invokePromise;
    // 브리지/목 환경이 응답 객체를 주지 않아도 누적 텍스트로 폴백 (TypeError 방지)
    return res?.text || accumulated;
  }

  const abort = createAbortPromise(
    abortSignal,
    cancelMessage,
    () => {
      stopped = true;
      void aiStreamCancel(streamId).catch(() => undefined);
    },
  );

  const res = await Promise.race([invokePromise, abort.promise])
    .finally(abort.cleanup);
  return res?.text || accumulated;
}
