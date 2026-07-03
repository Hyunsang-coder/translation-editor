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
}

export interface AiCompleteResponse {
  text: string;
}

export async function aiComplete(args: AiCompleteArgs): Promise<AiCompleteResponse> {
  return await invoke<AiCompleteResponse>('ai_complete', { args });
}

export interface AiStreamArgs extends AiCompleteArgs {
  streamId: string;
}

export type AiStreamEvent = { type: 'delta'; text: string };

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
