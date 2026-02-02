/**
 * Platform Abstraction Layer - Type Definitions
 *
 * Tauri와 Web 환경에서 공통으로 사용할 수 있는 인터페이스를 정의합니다.
 */

import type { ITEProject, ChatSession, GlossaryEntry } from '@/types';
import type { ChatProjectSettings } from '@/tauri/chat';

// ============================================
// Storage Adapter
// ============================================

export interface RecentProjectInfo {
  id: string;
  title: string;
  updatedAt: number;
}

export interface StorageAdapter {
  // Project operations
  createProject: (params: { title: string; domain: string }) => Promise<ITEProject>;
  saveProject: (project: ITEProject) => Promise<void>;
  loadProject: (projectId: string) => Promise<ITEProject>;
  deleteProject: (projectId: string) => Promise<void>;
  listProjectIds: () => Promise<string[]>;
  listRecentProjects: () => Promise<RecentProjectInfo[]>;

  // Chat operations
  saveChatSessions: (params: { projectId: string; sessions: ChatSession[] }) => Promise<void>;
  loadChatSessions: (projectId: string) => Promise<ChatSession[]>;
  saveChatProjectSettings: (params: { projectId: string; settings: ChatProjectSettings }) => Promise<void>;
  loadChatProjectSettings: (projectId: string) => Promise<ChatProjectSettings | null>;

  // Glossary operations
  searchGlossary: (params: {
    projectId: string;
    query: string;
    domain?: string;
    limit?: number;
  }) => Promise<GlossaryEntry[]>;
}

// ============================================
// Secrets Adapter
// ============================================

export interface SecretsAdapter {
  initialize: () => Promise<{ success: boolean; cachedCount: number }>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (keys: string[]) => Promise<void>;
  has: (key: string) => Promise<boolean>;
}

// ============================================
// Dialog Adapter
// ============================================

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DialogAdapter {
  pickFile: (options: {
    title: string;
    filters?: FileFilter[];
    multiple?: boolean;
  }) => Promise<string | null>;

  saveFile: (options: {
    title: string;
    defaultPath?: string;
    filters?: FileFilter[];
  }) => Promise<string | null>;

  confirm: (message: string) => Promise<boolean>;
  alert: (message: string) => Promise<void>;
}

// ============================================
// Attachments Adapter
// ============================================

/**
 * AttachmentDto - Tauri 백엔드와 호환되는 첨부 파일 DTO
 * 참고: src/tauri/attachments.ts의 AttachmentDto와 일치해야 함
 */
export interface AttachmentDto {
  id: string;
  filename: string;
  fileType: string;
  fileSize: number | null;
  extractedText?: string;
  filePath: string | null;
  createdAt: number;
  updatedAt: number;
  /** 이미지 첨부 시 미리보기용 base64 data URL (프론트엔드 전용) */
  thumbnailDataUrl?: string;
}

export interface AttachmentsAdapter {
  attach: (projectId: string, path: string) => Promise<AttachmentDto>;
  delete: (id: string) => Promise<void>;
  list: (projectId: string) => Promise<AttachmentDto[]>;
  preview: (path: string) => Promise<AttachmentDto>;
  readImageAsDataUrl: (path: string, fileType: string) => Promise<string | null>;
}

// ============================================
// AI Adapter (Web-only, Tauri uses direct API)
// ============================================

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatStreamOptions {
  messages: AiChatMessage[];
  model?: string;
  provider?: 'openai' | 'anthropic';
  temperature?: number;
  maxTokens?: number;
  onToken?: (fullText: string, delta: string) => void;
  onError?: (error: Error) => void;
  onDone?: (fullText: string) => void;
  abortSignal?: AbortSignal;
}

export interface AiTranslateStreamOptions {
  sourceMarkdown: string;
  sourceLanguage?: string;
  targetLanguage: string;
  translationRules?: string;
  projectContext?: string;
  translatorPersona?: string;
  glossary?: string;
  model?: string;
  provider?: 'openai' | 'anthropic';
  onToken?: (fullText: string, delta: string) => void;
  onError?: (error: Error) => void;
  onDone?: (fullResponse: string) => void;
  abortSignal?: AbortSignal;
}

export interface AiAdapter {
  streamChat: (options: AiChatStreamOptions) => Promise<string>;
  streamTranslate: (options: AiTranslateStreamOptions) => Promise<string>;
}

// ============================================
// Platform Adapter (Aggregate)
// ============================================

export interface PlatformAdapter {
  readonly type: 'tauri' | 'web';
  storage: StorageAdapter;
  secrets: SecretsAdapter;
  dialog: DialogAdapter;
  attachments: AttachmentsAdapter;
  /** AI adapter (웹 환경에서만 사용, Tauri에서는 null) */
  ai: AiAdapter | null;
}

// ============================================
// Platform Detection
// ============================================

export type PlatformType = 'tauri' | 'web';
