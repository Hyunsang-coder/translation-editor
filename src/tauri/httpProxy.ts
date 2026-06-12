import { Channel } from '@tauri-apps/api/core';
import { invoke } from '@/tauri/invoke';

export interface HttpProxyArgs {
  requestId: string;
  method: string;
  url: string;
  /** [name, value] 헤더 목록 */
  headers: [string, string][];
  body?: string | undefined;
}

export type HttpProxyEvent =
  | { type: 'head'; status: number; statusText: string; headers: [string, string][] }
  | { type: 'chunk'; base64: string }
  | { type: 'end' };

/**
 * 백엔드(reqwest)로 HTTP 요청을 대리 수행하고 응답을 Channel로 스트리밍한다.
 * onEvent로 head → chunk* → end 순서의 이벤트가 전달된다.
 */
export async function httpProxyStream(
  args: HttpProxyArgs,
  onEvent: (event: HttpProxyEvent) => void,
): Promise<void> {
  const channel = new Channel<HttpProxyEvent>();
  channel.onmessage = onEvent;
  await invoke<void>('http_proxy_stream', { args, onEvent: channel });
}

export async function httpProxyCancel(requestId: string): Promise<void> {
  await invoke('http_proxy_cancel', { requestId });
}
