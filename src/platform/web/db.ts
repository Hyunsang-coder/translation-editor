/**
 * IndexedDB Database Schema and Connection
 *
 * idb 라이브러리를 사용하여 IndexedDB를 관리합니다.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ITEProject, ChatSession, GlossaryEntry } from '@/types';
import type { ChatProjectSettings } from '@/tauri/chat';

// ============================================
// Database Schema
// ============================================

export interface OddEyesDB extends DBSchema {
  projects: {
    key: string;
    value: ITEProject;
    indexes: { 'by-updatedAt': number };
  };
  chatSessions: {
    key: string; // composite: `${projectId}:${sessionId}`
    value: ChatSession & { projectId: string };
    indexes: { 'by-projectId': string };
  };
  chatSettings: {
    key: string; // projectId
    value: ChatProjectSettings & { projectId: string };
  };
  glossary: {
    key: string; // composite: `${projectId}:${source}`
    value: GlossaryEntry & { projectId: string };
    indexes: { 'by-projectId': string };
  };
  attachments: {
    key: string; // attachment id
    value: {
      id: string;
      projectId: string;
      filename: string;
      fileType: string;
      sizeBytes: number;
      extractedText?: string;
      createdAt: number;
      // Web: 파일 내용을 Blob으로 저장
      blob?: Blob;
    };
    indexes: { 'by-projectId': string };
  };
  // 시크릿 저장 (웹 환경에서는 localStorage 대신 IndexedDB 사용)
  secrets: {
    key: string;
    value: { key: string; value: string };
  };
}

// ============================================
// Database Connection
// ============================================

const DB_NAME = 'oddeyes-web';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OddEyesDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<OddEyesDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OddEyesDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Version 1: Initial schema
        if (oldVersion < 1) {
          // Projects store
          const projectsStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectsStore.createIndex('by-updatedAt', 'metadata.updatedAt');

          // Chat sessions store
          const chatSessionsStore = db.createObjectStore('chatSessions', { keyPath: 'id' });
          chatSessionsStore.createIndex('by-projectId', 'projectId');

          // Chat settings store
          db.createObjectStore('chatSettings', { keyPath: 'projectId' });

          // Glossary store
          const glossaryStore = db.createObjectStore('glossary', { keyPath: ['projectId', 'source'] });
          glossaryStore.createIndex('by-projectId', 'projectId');

          // Attachments store
          const attachmentsStore = db.createObjectStore('attachments', { keyPath: 'id' });
          attachmentsStore.createIndex('by-projectId', 'projectId');

          // Secrets store
          db.createObjectStore('secrets', { keyPath: 'key' });
        }
      },
      blocked() {
        console.warn('[IndexedDB] Database upgrade blocked by another tab');
      },
      blocking() {
        console.warn('[IndexedDB] This tab is blocking a database upgrade in another tab');
      },
    });
  }
  return dbPromise;
}

/**
 * 데이터베이스 연결 테스트
 */
export async function testConnection(): Promise<boolean> {
  try {
    const db = await getDB();
    await db.count('projects');
    return true;
  } catch (e) {
    console.error('[IndexedDB] Connection test failed:', e);
    return false;
  }
}
