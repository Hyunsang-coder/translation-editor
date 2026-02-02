/**
 * Web Platform AI Adapter
 *
 * 웹 환경에서 /api/ai/* 엔드포인트를 통해 AI 기능을 제공합니다.
 * SSE 스트리밍을 사용하여 실시간 응답을 처리합니다.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatStreamOptions {
  messages: ChatMessage[];
  model?: string | undefined;
  provider?: 'openai' | 'anthropic' | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  onToken?: ((fullText: string, delta: string) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  onDone?: ((fullText: string) => void) | undefined;
  abortSignal?: AbortSignal | null | undefined;
}

export interface TranslateStreamOptions {
  sourceMarkdown: string;
  sourceLanguage?: string | undefined;
  targetLanguage: string;
  translationRules?: string | undefined;
  projectContext?: string | undefined;
  translatorPersona?: string | undefined;
  glossary?: string | undefined;
  model?: string | undefined;
  provider?: 'openai' | 'anthropic' | undefined;
  onToken?: ((fullText: string, delta: string) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  onDone?: ((fullResponse: string) => void) | undefined;
  abortSignal?: AbortSignal | null | undefined;
}

// API 베이스 URL (환경에 따라 다름)
function getApiBaseUrl(): string {
  // Vercel 배포 시에는 같은 도메인
  // 로컬 개발 시에는 환경변수로 설정 가능
  return import.meta.env.VITE_API_BASE_URL || '';
}

/**
 * SSE 스트림 파싱 헬퍼
 */
async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
): AsyncGenerator<{ type: string; content?: string; error?: string; fullResponse?: string }> {
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr) {
          try {
            yield JSON.parse(jsonStr);
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    }
  }

  // 버퍼에 남은 데이터 처리
  if (buffer.startsWith('data: ')) {
    const jsonStr = buffer.slice(6).trim();
    if (jsonStr) {
      try {
        yield JSON.parse(jsonStr);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * AI 채팅 스트리밍 요청
 */
export async function streamChat(options: ChatStreamOptions): Promise<string> {
  const {
    messages,
    model,
    provider,
    temperature,
    maxTokens,
    onToken,
    onError,
    onDone,
    abortSignal,
  } = options;

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/ai/chat`;

  let fullText = '';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        model,
        provider,
        temperature,
        maxTokens,
      }),
      ...(abortSignal ? { signal: abortSignal } : {}),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    for await (const event of parseSSEStream(reader, decoder)) {
      if (abortSignal?.aborted) {
        reader.cancel();
        break;
      }

      if (event.type === 'token' && event.content) {
        fullText += event.content;
        onToken?.(fullText, event.content);
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Stream error');
      } else if (event.type === 'done') {
        onDone?.(fullText);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // 사용자 취소
      return fullText;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    throw err;
  }

  return fullText;
}

/**
 * AI 번역 스트리밍 요청
 */
export async function streamTranslate(options: TranslateStreamOptions): Promise<string> {
  const {
    sourceMarkdown,
    sourceLanguage,
    targetLanguage,
    translationRules,
    projectContext,
    translatorPersona,
    glossary,
    model,
    provider,
    onToken,
    onError,
    onDone,
    abortSignal,
  } = options;

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/ai/translate`;

  let fullText = '';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceMarkdown,
        sourceLanguage,
        targetLanguage,
        translationRules,
        projectContext,
        translatorPersona,
        glossary,
        model,
        provider,
      }),
      ...(abortSignal ? { signal: abortSignal } : {}),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    for await (const event of parseSSEStream(reader, decoder)) {
      if (abortSignal?.aborted) {
        reader.cancel();
        break;
      }

      if (event.type === 'token' && event.content) {
        fullText += event.content;
        onToken?.(fullText, event.content);
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Stream error');
      } else if (event.type === 'done') {
        // 서버에서 fullResponse를 함께 보내면 사용
        const finalResponse = event.fullResponse || fullText;
        onDone?.(finalResponse);
        return finalResponse;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fullText;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    throw err;
  }

  return fullText;
}

/**
 * Web AI Adapter 객체
 */
export const webAiAdapter = {
  streamChat,
  streamTranslate,
};

export type WebAiAdapter = typeof webAiAdapter;
