/**
 * AI API 호출 재시도 유틸리티
 * Rate limit (429) 및 일시적 오류에 대한 exponential backoff 처리
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /**
   * 요청 취소용 AbortSignal. 전달되면 재시도 대기 sleep도 즉시 중단된다.
   * (요약처럼 선행 await가 UI를 묶는 경로에서 취소가 수 초 지연되는 것 방지)
   */
  signal?: AbortSignal;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * AbortError 판별. LangChain/provider 래핑으로 DOMException이 아닌
 * 일반 Error(name='AbortError')로 도착하는 경우도 커버하도록 name 기준이다.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // OpenAI and Anthropic rate limit patterns
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return true;
    }
  }
  // Check for response status in error object
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (err.status === 429 || err.statusCode === 429) {
      return true;
    }
  }
  return false;
}

export function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Temporary network/server errors
    if (message.includes('500') || message.includes('502') || message.includes('503') ||
        message.includes('timeout') || message.includes('network') || message.includes('econnreset')) {
      return true;
    }
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, signal } = { ...DEFAULT_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on abort (DOMException 여부와 무관하게 name 기준)
      if (isAbortError(error)) {
        throw error;
      }

      // Only retry on retryable errors
      if (!isRetryableError(error) || attempt >= maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms:`,
        error instanceof Error ? error.message : error);

      // signal이 abort되면 sleep이 즉시 AbortError로 reject되어 전파된다.
      await sleep(delay, signal);
    }
  }

  throw lastError;
}

