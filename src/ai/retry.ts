/**
 * AI API 호출 재시도 유틸리티
 * Rate limit (429) 및 일시적 오류에 대한 exponential backoff 처리
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isRetryableError(error: unknown): boolean {
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
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on abort
      if (error instanceof DOMException && error.name === 'AbortError') {
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

      await sleep(delay);
    }
  }

  throw lastError;
}

export { isRateLimitError, isRetryableError };
