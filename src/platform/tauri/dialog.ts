/**
 * Tauri Dialog Adapter
 *
 * 기존 src/tauri/dialog.ts를 DialogAdapter 인터페이스로 래핑합니다.
 */

import type { DialogAdapter } from '../types';
import { open, save, confirm, message } from '@tauri-apps/plugin-dialog';

export const tauriDialogAdapter: DialogAdapter = {
  pickFile: async (options) => {
    const file = await open({
      title: options.title,
      multiple: options.multiple ?? false,
      ...(options.filters && options.filters.length > 0
        ? {
            filters: options.filters.map((f) => ({
              name: f.name,
              extensions: f.extensions,
            })),
          }
        : {}),
    });

    if (!file) return null;
    return Array.isArray(file) ? (file[0] ?? null) : file;
  },

  saveFile: async (options) => {
    const path = await save({
      title: options.title,
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
      ...(options.filters && options.filters.length > 0
        ? {
            filters: options.filters.map((f) => ({
              name: f.name,
              extensions: f.extensions,
            })),
          }
        : {}),
    });

    return path ?? null;
  },

  confirm: async (msg) => {
    return await confirm(msg, { title: 'Confirm', kind: 'warning' });
  },

  alert: async (msg) => {
    await message(msg, { title: 'Alert', kind: 'info' });
  },
};
