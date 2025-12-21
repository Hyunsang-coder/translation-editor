import { invoke as tauriInvoke } from '@tauri-apps/api/core';

/**
 * Tauri 환경 여부(대략적) 체크
 */
export function isTauriRuntime(): boolean {
  const g = globalThis as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return typeof g.__TAURI__ !== 'undefined' || typeof g.__TAURI_INTERNALS__ !== 'undefined';
}

/**
 * 타입 안전 invoke 래퍼
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Tauri runtime not detected. Tried to invoke: ${cmd}`);
  }
  return await tauriInvoke<T>(cmd, args);
}


