/**
 * Tauri Attachments Adapter
 *
 * 기존 src/tauri/attachments.ts를 AttachmentsAdapter 인터페이스로 래핑합니다.
 */

import type { AttachmentsAdapter } from '../types';
import {
  attachFile,
  deleteAttachment,
  listAttachments,
  previewAttachment,
  readImageAsDataUrl,
} from '@/tauri/attachments';

export const tauriAttachmentsAdapter: AttachmentsAdapter = {
  attach: async (projectId, path) => {
    return await attachFile(projectId, path);
  },

  delete: async (id) => {
    await deleteAttachment(id);
  },

  list: async (projectId) => {
    return await listAttachments(projectId);
  },

  preview: async (path) => {
    return await previewAttachment(path);
  },

  readImageAsDataUrl: async (path, fileType) => {
    return await readImageAsDataUrl(path, fileType);
  },
};
