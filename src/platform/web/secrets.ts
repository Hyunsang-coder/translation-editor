/**
 * Web Secrets Adapter
 *
 * 웹 환경에서는 API 키를 직접 저장하지 않고,
 * Vercel 환경변수를 통해 서버 사이드에서 관리합니다.
 *
 * 이 어댑터는 주로 호환성을 위한 스텁 구현입니다.
 * 실제 API 호출은 /api 프록시를 통해 이루어집니다.
 */

import type { SecretsAdapter } from '../types';
import { getDB } from './db';

// 웹 환경에서 허용되는 시크릿 키 (API 키는 제외)
const ALLOWED_KEYS = [
  'notion_access_token',
  'confluence_access_token',
];

export const webSecretsAdapter: SecretsAdapter = {
  initialize: async () => {
    // 웹 환경에서는 별도의 초기화가 필요 없음
    try {
      const db = await getDB();
      const count = await db.count('secrets');
      return { success: true, cachedCount: count };
    } catch {
      return { success: false, cachedCount: 0 };
    }
  },

  get: async (key) => {
    // API 키는 웹에서 직접 접근 불가 (서버 프록시 사용)
    if (key.includes('api_key') || key.includes('apiKey')) {
      console.warn(`[WebSecrets] API keys are not accessible in web environment: ${key}`);
      return null;
    }

    if (!ALLOWED_KEYS.includes(key)) {
      return null;
    }

    try {
      const db = await getDB();
      const entry = await db.get('secrets', key);
      return entry?.value ?? null;
    } catch {
      return null;
    }
  },

  set: async (key, value) => {
    // API 키는 웹에서 저장 불가
    if (key.includes('api_key') || key.includes('apiKey')) {
      console.warn(`[WebSecrets] API keys cannot be stored in web environment: ${key}`);
      return;
    }

    if (!ALLOWED_KEYS.includes(key)) {
      console.warn(`[WebSecrets] Key not allowed in web environment: ${key}`);
      return;
    }

    try {
      const db = await getDB();
      await db.put('secrets', { key, value });
    } catch (e) {
      console.error('[WebSecrets] Failed to set secret:', e);
    }
  },

  delete: async (keys) => {
    try {
      const db = await getDB();
      const tx = db.transaction('secrets', 'readwrite');
      for (const key of keys) {
        await tx.store.delete(key);
      }
      await tx.done;
    } catch (e) {
      console.error('[WebSecrets] Failed to delete secrets:', e);
    }
  },

  has: async (key) => {
    // API 키는 항상 false 반환 (서버 프록시 사용)
    if (key.includes('api_key') || key.includes('apiKey')) {
      return false;
    }

    try {
      const db = await getDB();
      const entry = await db.get('secrets', key);
      return entry !== undefined;
    } catch {
      return false;
    }
  },
};
