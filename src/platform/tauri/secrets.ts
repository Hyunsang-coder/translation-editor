/**
 * Tauri Secrets Adapter
 *
 * 기존 src/tauri/secrets.ts를 SecretsAdapter 인터페이스로 래핑합니다.
 */

import type { SecretsAdapter } from '../types';
import {
  initializeSecrets,
  getSecret,
  setSecret,
  deleteSecrets,
  hasSecret,
} from '@/tauri/secrets';

export const tauriSecretsAdapter: SecretsAdapter = {
  initialize: async () => {
    const result = await initializeSecrets();
    return { success: result.success, cachedCount: result.cachedCount };
  },

  get: async (key) => {
    return await getSecret(key);
  },

  set: async (key, value) => {
    await setSecret(key, value);
  },

  delete: async (keys) => {
    await deleteSecrets(keys);
  },

  has: async (key) => {
    return await hasSecret(key);
  },
};
