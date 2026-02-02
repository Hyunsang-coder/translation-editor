/**
 * Web AI Proxy Client
 *
 * 웹 환경에서 Vercel API Routes를 통해 AI 기능을 사용하는 클라이언트입니다.
 * Tauri 환경에서는 직접 LangChain API를 호출하고,
 * 웹 환경에서는 /api/ai/* 프록시를 통해 호출합니다.
 */

import { isTauriRuntime } from '@/platform';

// ============================================
// Types
// ============================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface WebChatOptions {
  messages: ChatMessage[];
  model?: string | undefined;
  provider?: 'openai' | 'anthropic' | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  onToken?: ((fullText: string, delta: string) => void) | undefined;
  abortSignal?: AbortSignal | null | undefined;
}

export interface WebTranslateOptions {
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
  abortSignal?: AbortSignal | null | undefined;
}

// ============================================
// Platform Check
// ============================================

/**
 * 웹 프록시를 사용해야 하는지 확인
 * - Tauri 환경: false (직접 API 호출)
 * - 웹 환경: true (프록시 사용)
 */
export function shouldUseWebProxy(): boolean {
  return !isTauriRuntime();
}

// ============================================
// API Base URL
// ============================================

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || '';
}

// ============================================
// SSE Stream Parser
// ============================================

interface SSEEvent {
  type: string;
  content?: string;
  error?: string;
  fullResponse?: string;
}

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
): AsyncGenerator<SSEEvent> {
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

// ============================================
// Web Proxy API Calls
// ============================================

/**
 * 웹 프록시를 통한 채팅 스트리밍
 */
export async function webProxyChat(options: WebChatOptions): Promise<string> {
  const { messages, model, provider, temperature, maxTokens, onToken, abortSignal } = options;

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/ai/chat`;

  let fullText = '';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model, provider, temperature, maxTokens }),
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
    }
  }

  return fullText;
}

/**
 * 웹 프록시를 통한 번역 스트리밍
 */
export async function webProxyTranslate(options: WebTranslateOptions): Promise<string> {
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
    abortSignal,
  } = options;

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/ai/translate`;

  let fullText = '';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      return event.fullResponse || fullText;
    }
  }

  return fullText;
}
