import type { ChatSession, ChatMessage, GlossaryEntry } from '@/types';
import type { AttachmentDto } from '@/tauri/attachments';

// ── Constants ──────────────────────────────────────────────────────────

export const CHAT_PERSIST_DEBOUNCE_MS = 800;
export const MAX_CHAT_SESSIONS = 5;
export const MAX_MESSAGES_PER_SESSION = 1000;
export const CHAT_LENGTH_THRESHOLD = 30;
export const DEFAULT_TRANSLATOR_PERSONA = '';

/** 도구 이름 → 한국어 표시명 매핑 (sendMessage/replayMessage 공용) */
export const TOOL_NAME_MAP: Record<string, string> = {
  'web_search': '웹 검색',
  'web_search_preview': '웹 검색',
  'get_source_document': '원문 문서 조회',
  'get_target_document': '번역문 문서 조회',
  'suggest_translation_rule': '번역 규칙 생성',
  'suggest_project_context': '프로젝트 맥락 분석',
  'notion_search': 'Notion 검색',
  'notion_get_page': 'Notion 페이지 조회',
  'notion_query_database': 'Notion 데이터베이스 조회',
};

// ── State Interface ────────────────────────────────────────────────────

export interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSession: ChatSession | null;
  isLoading: boolean;
  isHydrating: boolean;
  /** finalization 진행 중 여부 (Race Condition 방지) */
  isFinalizingStreaming: boolean;
  streamingMessageId: string | null;
  /** 스트리밍 중인 메시지가 속한 세션 ID (듀얼 사이드바 격리용) */
  streamingSessionId: string | null;
  /** 스트리밍 중인 메시지 콘텐츠 (배열 갱신 없이 단일 필드만 업데이트) */
  streamingContent: string | null;
  /** 스트리밍 중인 메시지의 메타데이터 */
  streamingMetadata: ChatMessage['metadata'] | null;
  error: string | null;
  statusMessage: string | null;
  /** 최근 요청에서 주입된 글로서리(디버깅/가시화) */
  lastInjectedGlossary: GlossaryEntry[];
  /** 대화 길이 알림: 세션별 dismiss 상태 */
  summarySuggestionDismissedBySessionId: Record<string, boolean>;
  /** Chat composer */
  composerText: string;
  composerFocusNonce: number;
  /** 외부 append 이벤트 (Cmd+L 등) → ChatContent가 subscribe로 소비 */
  pendingComposerAppend: {
    text: string;
    separator: string;
    targetSessionId: string | null;
    nonce: number;
  } | null;
  translatorPersona: string;
  translationRules: string;
  projectContext: string;
  /** 웹검색 사용 여부 (tool availability gate) */
  webSearchEnabled: boolean;
  /**
   * 문서 전체 번역(Preview→Apply) 컨텍스트로 사용할 채팅 탭
   * - null이면 현재 탭(currentSession)의 최신 메시지 10개를 사용
   */
  translationContextSessionId: string | null;
  /** 현재 로드된 프로젝트 ID (저장 시 검증용) */
  loadedProjectId: string | null;
  /** 첨부 파일 목록 (4.2) */
  attachments: AttachmentDto[];
  /** 채팅 컴포저 전용 첨부(일회성, 비영속) */
  composerAttachments: AttachmentDto[];
  /** 진행 중인 API 요청 취소용 AbortController */
  abortController: AbortController | null;
}

// ── Actions Interface ──────────────────────────────────────────────────

export interface ChatActions {
  // 세션 관리
  createSession: (name?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;

  // 메시지 관리
  sendMessage: (content: string, targetSessionId?: string) => Promise<void>;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>, targetSessionId?: string) => string | null;
  updateMessage: (
    messageId: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>,
    targetSessionId?: string,
  ) => void;
  /** 메시지 수정: 해당 메시지 이후 대화는 truncate됩니다. */
  editMessage: (messageId: string, nextContent: string, targetSessionId?: string) => void;
  /** 메시지 수정 후 같은 내용으로 다시 호출 */
  replayMessage: (messageId: string, targetSessionId?: string) => Promise<void>;
  /** 메시지 삭제: 해당 메시지(포함) 이후 대화는 truncate됩니다. */
  deleteMessageFrom: (messageId: string, targetSessionId?: string) => void;
  clearMessages: (targetSessionId?: string) => void;

  // Composer
  setComposerText: (text: string) => void;
  appendComposerText: (text: string, opts?: { separator?: string }) => void;
  requestComposerFocus: () => void;

  // 컨텍스트 블록 관리
  setContextBlocks: (blockIds: string[]) => void;
  addContextBlock: (blockId: string) => void;
  removeContextBlock: (blockId: string) => void;

  // 대화 길이 알림
  shouldShowSummarySuggestion: () => boolean;
  dismissSummarySuggestion: () => void;
  startNewSessionFromSuggestion: () => void;

  // 세션 제한 헬퍼
  isSessionLimitReached: () => boolean;
  getOldestSession: () => ChatSession | null;

  // 유틸리티
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  setTranslatorPersona: (persona: string) => void;
  setTranslationRules: (rules: string) => void;
  appendToTranslationRules: (snippet: string) => void;
  setProjectContext: (memory: string) => void;
  appendToProjectContext: (snippet: string) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setConfluenceSearchEnabled: (enabled: boolean) => void;
  setTranslationContextSessionId: (sessionId: string | null) => void;

  // 첨부 파일 관리 (4.2)
  attachFile: (path: string) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  loadAttachments: () => Promise<void>;
  // 채팅 컴포저 전용 첨부(일회성)
  addComposerAttachment: (path: string) => Promise<void>;
  removeComposerAttachment: (id: string) => void;
  clearComposerAttachments: () => void;

  // Persistence (project-scoped)
  hydrateForProject: (projectId: string | null) => Promise<void>;

  // Streaming 상태 관리 (성능 최적화: 배열 갱신 없이 단일 필드만 업데이트)
  setStreamingContent: (content: string) => void;
  setStreamingMetadata: (metadata: ChatMessage['metadata']) => void;
  finalizeStreaming: () => void;
}

// ── Composite Type ─────────────────────────────────────────────────────

export type ChatStore = ChatState & ChatActions;

// ── Slice Creator Helper Types ─────────────────────────────────────────

/** Zustand set function type for slice creators */
export type ChatSet = {
  (partial: ChatStore | Partial<ChatStore> | ((state: ChatStore) => ChatStore | Partial<ChatStore>), replace?: false): void;
};

/** Zustand get function type for slice creators */
export type ChatGet = () => ChatStore;
