/**
 * Tauri Storage Adapter
 *
 * 기존 src/tauri/ 모듈들을 StorageAdapter 인터페이스로 래핑합니다.
 */

import type { StorageAdapter } from '../types';
import type { ITEProject, ProjectDomain } from '@/types';
import { invoke } from '@/tauri/invoke';
import {
  saveChatSessions as tauriSaveChatSessions,
  loadChatSessions as tauriLoadChatSessions,
  saveChatProjectSettings as tauriSaveChatProjectSettings,
  loadChatProjectSettings as tauriLoadChatProjectSettings,
} from '@/tauri/chat';
import { searchGlossary as tauriSearchGlossary } from '@/tauri/glossary';

export const tauriStorageAdapter: StorageAdapter = {
  // Project operations
  createProject: async (params) => {
    return await invoke<ITEProject>('create_project', {
      args: {
        title: params.title,
        domain: params.domain as ProjectDomain,
      },
    });
  },

  saveProject: async (project) => {
    await invoke<void>('save_project', { project });
  },

  loadProject: async (projectId) => {
    return await invoke<ITEProject>('load_project', { args: { projectId } });
  },

  deleteProject: async (projectId) => {
    await invoke<void>('delete_project', { args: { projectId } });
  },

  listProjectIds: async () => {
    return await invoke<string[]>('list_project_ids');
  },

  listRecentProjects: async () => {
    return await invoke<{ id: string; title: string; updatedAt: number }[]>('list_recent_projects');
  },

  // Chat operations
  saveChatSessions: async (params) => {
    await tauriSaveChatSessions(params);
  },

  loadChatSessions: async (projectId) => {
    return await tauriLoadChatSessions(projectId);
  },

  saveChatProjectSettings: async (params) => {
    await tauriSaveChatProjectSettings(params);
  },

  loadChatProjectSettings: async (projectId) => {
    return await tauriLoadChatProjectSettings(projectId);
  },

  // Glossary operations
  searchGlossary: async (params) => {
    return await tauriSearchGlossary(params);
  },
};
