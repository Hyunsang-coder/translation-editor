import { invoke, isTauriRuntime } from '@/tauri/invoke';

export type SecureKeyId = 'openai' | 'anthropic' | 'brave' | 'api_keys_bundle';

function buildKeyId(key: SecureKeyId): string {
  return `ai:${key}`;
}

export async function setSecureSecret(key: SecureKeyId, value: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>('set_secure_secret', { args: { key: buildKeyId(key), value } });
}

export async function getSecureSecret(key: SecureKeyId): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return await invoke<string | null>('get_secure_secret', { key: buildKeyId(key) });
}

export async function deleteSecureSecret(key: SecureKeyId): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>('delete_secure_secret', { key: buildKeyId(key) });
}
