import { Channel } from '@tauri-apps/api/core';
import { invoke } from '@/tauri/invoke';
import type { AiProvider } from '@/ai/config';

export interface AiCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompleteArgs {
  provider: Exclude<AiProvider, 'mock'>;
  apiKey: string;
  model: string;
  maxTokens: number;
  messages: AiCompletionMessage[];
  temperature?: number | undefined;
  /** Anthropic adaptive thinking (thinking: {type: "adaptive"}) */
  adaptiveThinking?: boolean | undefined;
  /** Anthropic output_config.effort / OpenAI reasoning_effort */
  effort?: string | undefined;
  /**
   * Anthropic prompt caching: system 블록에 cache_control breakpoint 적용.
   * 같은 system을 재사용하는 호출(검수 청크, 번역 청킹)에서만 켠다.
   */
  cacheSystem?: boolean | undefined;
}

/**
 * provider별 usage를 하나의 스키마로 정규화한 값 (Rust `AiUsage`와 1:1).
 *
 * `inputTokens`는 캐시 read/write를 제외한 **순수 입력**이다.
 * OpenAI의 `prompt_tokens`는 캐시분을 포함한 총합이라 Rust에서 이미 빼서 넘겨준다.
 */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AiCompleteResponse {
  text: string;
  /** provider가 usage를 보고하지 않으면 null. 스트리밍은 항상 null(‘usage’ 이벤트로 옴). */
  usage?: AiUsage | null;
}

export async function aiComplete(args: AiCompleteArgs): Promise<AiCompleteResponse> {
  return await invoke<AiCompleteResponse>('ai_complete', { args });
}

export interface AiStreamArgs extends AiCompleteArgs {
  streamId: string;
}

export type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: AiUsage };

/**
 * 백엔드 SSE 스트리밍 호출.
 * 토큰 델타는 onEvent로 실시간 전달되고, 최종 전체 텍스트는 반환값으로 돌려받는다.
 */
export async function aiStream(
  args: AiStreamArgs,
  onEvent: (event: AiStreamEvent) => void,
): Promise<AiCompleteResponse> {
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = onEvent;
  return await invoke<AiCompleteResponse>('ai_stream', { args, onEvent: channel });
}

export async function aiStreamCancel(streamId: string): Promise<void> {
  await invoke('ai_stream_cancel', { streamId });
}
