/**
 * Platform Abstraction Layer - Entry Point
 *
 * 실행 환경(Tauri/Web)에 따라 적절한 어댑터를 반환합니다.
 */

import type { PlatformAdapter, PlatformType } from './types';

// Lazy-loaded adapters to avoid circular dependencies
let cachedPlatform: PlatformAdapter | null = null;

/**
 * Tauri 런타임 환경 여부 확인
 */
export function isTauriRuntime(): boolean {
  const g = globalThis as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return typeof g.__TAURI__ !== 'undefined' || typeof g.__TAURI_INTERNALS__ !== 'undefined';
}

/**
 * 현재 플랫폼 타입 반환
 */
export function getPlatformType(): PlatformType {
  return isTauriRuntime() ? 'tauri' : 'web';
}

/**
 * 플랫폼 어댑터 반환 (싱글톤)
 */
export async function getPlatform(): Promise<PlatformAdapter> {
  if (cachedPlatform) {
    return cachedPlatform;
  }

  if (isTauriRuntime()) {
    const { tauriAdapter } = await import('./tauri');
    cachedPlatform = tauriAdapter;
  } else {
    const { webAdapter } = await import('./web');
    cachedPlatform = webAdapter;
  }

  return cachedPlatform;
}

/**
 * 플랫폼 어댑터 동기 반환 (초기화 후에만 사용)
 * 주의: getPlatform()을 먼저 호출하여 초기화해야 합니다.
 */
export function getPlatformSync(): PlatformAdapter | null {
  return cachedPlatform;
}

/**
 * 플랫폼 초기화 (앱 시작 시 호출)
 */
export async function initializePlatform(): Promise<PlatformAdapter> {
  const platform = await getPlatform();

  // Secrets 초기화 (Tauri에서는 Keychain 접근)
  try {
    await platform.secrets.initialize();
  } catch (e) {
    console.warn('[Platform] Secrets initialization failed:', e instanceof Error ? e.message : e);
  }

  return platform;
}

// Re-export types
export type { PlatformAdapter, PlatformType, StorageAdapter, SecretsAdapter, DialogAdapter, AttachmentsAdapter } from './types';
