/**
 * Web Storage Adapter
 *
 * IndexedDB를 사용한 프로젝트/채팅 저장소입니다.
 */

import type { StorageAdapter } from '../types';
import type { ITEProject, ChatSession, GlossaryEntry } from '@/types';
import type { ChatProjectSettings } from '@/tauri/chat';
import { getDB } from './db';
import { v4 as uuidv4 } from 'uuid';
import { hashContent } from '@/utils/hash';

// ============================================
// Helper: Create Initial Project
// ============================================

function createInitialProject(title: string, domain: string): ITEProject {
  const now = Date.now();
  const projectId = uuidv4();
  const sourceBlock1Id = uuidv4();
  const targetBlock1Id = uuidv4();

  return {
    id: projectId,
    version: '1.0.0',
    metadata: {
      title,
      description: '',
      domain: domain as ITEProject['metadata']['domain'],
      createdAt: now,
      updatedAt: now,
      settings: {
        strictnessLevel: 0.5,
        autoSave: true,
        autoSaveInterval: 30000,
        theme: 'system',
      },
    },
    segments: [
      {
        groupId: uuidv4(),
        sourceIds: [sourceBlock1Id],
        targetIds: [targetBlock1Id],
        isAligned: true,
        order: 0,
      },
    ],
    blocks: {
      [sourceBlock1Id]: {
        id: sourceBlock1Id,
        type: 'source',
        content: '<p>Hello, welcome to OddEyes.ai.</p>',
        hash: hashContent('Hello, welcome to OddEyes.ai.'),
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
      [targetBlock1Id]: {
        id: targetBlock1Id,
        type: 'target',
        content: '<p></p>',
        hash: hashContent(''),
        metadata: { createdAt: now, updatedAt: now, tags: [] },
      },
    },
    history: [],
  };
}

// ============================================
// Web Storage Adapter Implementation
// ============================================

export const webStorageAdapter: StorageAdapter = {
  // Project operations
  createProject: async (params) => {
    const db = await getDB();
    const project = createInitialProject(params.title, params.domain);
    await db.put('projects', project);
    return project;
  },

  saveProject: async (project) => {
    const db = await getDB();
    await db.put('projects', project);
  },

  loadProject: async (projectId) => {
    const db = await getDB();
    const project = await db.get('projects', projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  },

  deleteProject: async (projectId) => {
    const db = await getDB();
    await db.delete('projects', projectId);

    // Also delete related chat sessions and settings
    const tx = db.transaction(['chatSessions', 'chatSettings', 'glossary', 'attachments'], 'readwrite');

    // Delete chat sessions
    const sessions = await tx.objectStore('chatSessions').index('by-projectId').getAllKeys(projectId);
    for (const key of sessions) {
      await tx.objectStore('chatSessions').delete(key);
    }

    // Delete chat settings
    await tx.objectStore('chatSettings').delete(projectId);

    // Delete glossary entries
    const glossaryKeys = await tx.objectStore('glossary').index('by-projectId').getAllKeys(projectId);
    for (const key of glossaryKeys) {
      await tx.objectStore('glossary').delete(key);
    }

    // Delete attachments
    const attachmentKeys = await tx.objectStore('attachments').index('by-projectId').getAllKeys(projectId);
    for (const key of attachmentKeys) {
      await tx.objectStore('attachments').delete(key);
    }

    await tx.done;
  },

  listProjectIds: async () => {
    const db = await getDB();
    return await db.getAllKeys('projects');
  },

  listRecentProjects: async () => {
    const db = await getDB();
    const projects = await db.getAll('projects');

    return projects
      .sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        title: p.metadata.title,
        updatedAt: p.metadata.updatedAt,
      }));
  },

  // Chat operations
  saveChatSessions: async ({ projectId, sessions }) => {
    const db = await getDB();
    const tx = db.transaction('chatSessions', 'readwrite');

    // Delete existing sessions for this project
    const existingKeys = await tx.store.index('by-projectId').getAllKeys(projectId);
    for (const key of existingKeys) {
      await tx.store.delete(key);
    }

    // Save new sessions
    for (const session of sessions) {
      await tx.store.put({ ...session, projectId });
    }

    await tx.done;
  },

  loadChatSessions: async (projectId) => {
    const db = await getDB();
    const sessions = await db.getAllFromIndex('chatSessions', 'by-projectId', projectId);
    // Remove projectId from returned sessions
    return sessions.map(({ projectId: _, ...session }) => session as ChatSession);
  },

  saveChatProjectSettings: async ({ projectId, settings }) => {
    const db = await getDB();
    await db.put('chatSettings', { ...settings, projectId });
  },

  loadChatProjectSettings: async (projectId) => {
    const db = await getDB();
    const settings = await db.get('chatSettings', projectId);
    if (!settings) return null;
    const { projectId: _, ...rest } = settings;
    return rest as ChatProjectSettings;
  },

  // Glossary operations
  searchGlossary: async ({ projectId, query, limit = 10 }) => {
    const db = await getDB();
    const entries = await db.getAllFromIndex('glossary', 'by-projectId', projectId);

    // Simple text matching (case-insensitive)
    const queryLower = query.toLowerCase();
    const matches = entries.filter(
      (e) =>
        e.source.toLowerCase().includes(queryLower) ||
        e.target.toLowerCase().includes(queryLower) ||
        (e.notes?.toLowerCase().includes(queryLower) ?? false)
    );

    return matches.slice(0, limit).map(({ projectId: _, ...entry }) => entry as GlossaryEntry);
  },
};
