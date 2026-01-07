/**
 * Secrets Manager Tauri IPC 래퍼
 *
 * SecretManager를 통해 시크릿을 안전하게 관리합니다.
 * - Keychain 접근은 마스터키 로드 시 1회만 발생
 * - 나머지는 암호화된 Vault 파일에서 관리
 */

import { invoke, isTauriRuntime } from '@/tauri/invoke';

/**
 * 시크릿 엔트리 (key-value 쌍)
 */
export interface SecretEntry {
  key: string;
  value: string;
}

/**
 * 초기화 결과
 */
export interface SecretsInitResult {
  initialized: boolean;
  cached_count: number;
}

/**
 * 마이그레이션 결과
 */
export interface MigrationResult {
  migrated: number;
  failed: number;
  details: string[];
}

/**
 * SecretManager 초기화
 *
 * 앱 시작 시 1회 호출하여 마스터키를 로드하고 Vault를 복호화합니다.
 * 이 명령 호출 시 Keychain 프롬프트가 최대 1회 발생할 수 있습니다.
 */
export async function initializeSecrets(): Promise<SecretsInitResult> {
  if (!isTauriRuntime()) {
    console.warn('[Secrets] Not in Tauri runtime, skipping initialization');
    return { initialized: false, cached_count: 0 };
  }

  try {
    const result = await invoke<SecretsInitResult>('secrets_initialize');
    console.log('[Secrets] Initialized, cached secrets:', result.cached_count);
    return result;
  } catch (error) {
    console.error('[Secrets] Initialization failed:', error);
    throw error;
  }
}

/**
 * 시크릿 조회 (단일)
 *
 * Keychain 프롬프트 없이 메모리 캐시에서 조회합니다.
 */
export async function getSecret(key: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return await invoke<string | null>('secrets_get_one', { key });
}

/**
 * 시크릿 조회 (여러 개)
 *
 * Keychain 프롬프트 없이 메모리 캐시에서 조회합니다.
 */
export async function getSecrets(keys: string[]): Promise<Record<string, string>> {
  if (!isTauriRuntime()) {
    return {};
  }

  return await invoke<Record<string, string>>('secrets_get', { keys });
}

/**
 * 시크릿 저장 (단일)
 */
export async function setSecret(key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn('[Secrets] Not in Tauri runtime, skipping save');
    return;
  }

  await invoke<void>('secrets_set_one', { key, value });
}

/**
 * 시크릿 저장 (여러 개)
 */
export async function setSecrets(entries: SecretEntry[]): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn('[Secrets] Not in Tauri runtime, skipping save');
    return;
  }

  await invoke<void>('secrets_set', { entries });
}

/**
 * 시크릿 삭제
 */
export async function deleteSecrets(keys: string[]): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke<void>('secrets_delete', { keys });
}

/**
 * 시크릿 존재 여부 확인
 *
 * Keychain 프롬프트 없이 확인합니다.
 */
export async function hasSecret(key: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  return await invoke<boolean>('secrets_has', { key });
}

/**
 * 특정 prefix로 시작하는 시크릿 키 목록 조회
 */
export async function listSecretKeys(prefix: string): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return await invoke<string[]>('secrets_list_keys', { prefix });
}

/**
 * 기존 Keychain 엔트리를 Vault로 마이그레이션
 *
 * Settings에서 사용자가 명시적으로 실행하는 것을 권장합니다.
 * 마이그레이션 성공 시 기존 Keychain 엔트리는 삭제됩니다.
 */
export async function migrateLegacySecrets(): Promise<MigrationResult> {
  if (!isTauriRuntime()) {
    return { migrated: 0, failed: 0, details: [] };
  }

  return await invoke<MigrationResult>('secrets_migrate_legacy');
}

