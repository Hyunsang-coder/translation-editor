/**
 * Tauri Platform Adapter
 *
 * 기존 Tauri IPC 래퍼들을 PlatformAdapter 인터페이스로 통합합니다.
 */

import type { PlatformAdapter } from '../types';
import { tauriStorageAdapter } from './storage';
import { tauriSecretsAdapter } from './secrets';
import { tauriDialogAdapter } from './dialog';
import { tauriAttachmentsAdapter } from './attachments';

export const tauriAdapter: PlatformAdapter = {
  type: 'tauri',
  storage: tauriStorageAdapter,
  secrets: tauriSecretsAdapter,
  dialog: tauriDialogAdapter,
  attachments: tauriAttachmentsAdapter,
  // Tauri에서는 직접 LangChain API 호출 (API 키가 Keychain에 저장됨)
  ai: null,
};
