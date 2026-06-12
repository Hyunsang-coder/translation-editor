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
 * Rust 측 CommandError({ code, message, details })를 보존하는 Error.
 *
 * Tauri invoke는 Rust 명령이 Err를 반환하면 plain object로 reject 한다.
 * 이를 그대로 두면 `String(error)`가 "[object Object]"가 되어 원인이 사라지므로,
 * 메시지를 갖춘 Error로 정규화하되 code/details/raw는 보존한다.
 */
export class TauriCommandError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly raw: unknown;

  constructor(raw: unknown, cmd: string) {
    const obj =
      raw && typeof raw === 'object'
        ? (raw as { code?: unknown; message?: unknown; details?: unknown })
        : undefined;
    const message =
      typeof raw === 'string'
        ? raw
        : typeof obj?.message === 'string' && obj.message.trim()
          ? obj.message.trim()
          : typeof obj?.code === 'string' && obj.code.trim()
            ? obj.code.trim()
            : `명령 실행에 실패했습니다: ${cmd}`;
    super(message);
    this.name = 'TauriCommandError';
    this.code = typeof obj?.code === 'string' ? obj.code : undefined;
    this.details = typeof obj?.details === 'string' ? obj.details : undefined;
    this.raw = raw;
  }
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
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (raw) {
    // 이미 Error면 그대로 전파(취소 등), plain object/문자열이면 정규화
    if (raw instanceof Error) {
      throw raw;
    }
    throw new TauriCommandError(raw, cmd);
  }
}


