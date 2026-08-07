import type {
  ChatSession,
  ChatMessage,
  ChatSessionMemory,
  GlossaryEntry,
  SelectionContext,
  SendMessageOptions,
} from '@/types';
import type { AttachmentDto } from '@/tauri/attachments';
import type { SelectableProvider } from '@/ai/config';

// ── Constants ──────────────────────────────────────────────────────────

export const CHAT_PERSIST_DEBOUNCE_MS = 800;
export const MAX_CHAT_SESSIONS = 5;
export const MAX_MESSAGES_PER_SESSION = 1000;

export interface PendingComposerAppend {
  text: string;
  separator: string;
  targetSessionId: string | null;
  nonce: number;
}

// ── State Interface ────────────────────────────────────────────────────

export interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSession: ChatSession | null;
  isLoading: boolean;
  /** 첨부 파일 작업 진행 중 여부 (isLoading과 분리: AI 응답 스켈레톤 방지) */
  isAttachmentLoading: boolean;
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
  /** Chat composer */
  composerText: string;
  /** 현재 채팅 입력에 첨부된 runtime 선택 영역. 문서 위치 자체는 TipTap plugin이 관리한다. */
  composerSelection: SelectionContext | null;
  activeSelectionScopeIdBySession: Record<string, string | null>;
  composerFocusNonce: number;
  /** 외부 focus 이벤트 (Cmd+L 등) → ChatContent가 subscribe로 소비 */
  pendingComposerFocus: {
    targetSessionId: string | null;
    nonce: number;
  } | null;
  /** 외부 append 이벤트 (Cmd+L 등) → ChatContent가 subscribe로 소비 */
  pendingComposerAppend: PendingComposerAppend | null;
  translationRules: string;
  /**
   * 마이그레이션 전용 레거시 필드. 새로 쓰는 경로는 없다 — hydrate가 DB에서 읽어
   * `projectMemoryStore.hydrate`에 넘기면 구조화 메모리 항목으로 1회 변환된다.
   * `buildContextSnapshot`은 변환 실패 시에만 이 값을 폴백으로 쓴다.
   */
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
  /** 세션에 고정된 provider 변경 (전역 provider와 분리, 첫 메시지 전까지만 허용) */
  setSessionModelPreset: (sessionId: string, preset: SelectableProvider) => void;
  /** 세션 장기 대화 요약(memory) 갱신 (Phase 3, transcript는 보존) */
  updateSessionMemory: (sessionId: string, memory: ChatSessionMemory) => void;

  // 메시지 관리
  sendMessage: (
    content: string,
    targetSessionIdOrOptions?: string | SendMessageOptions,
  ) => Promise<void>;
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
  setComposerSelection: (
    selection: SelectionContext | null,
    targetSessionId?: string,
  ) => void;
  clearComposerSelection: (targetSessionId?: string) => void;
  setActiveSelectionScope: (sessionId: string, scopeId: string | null) => void;
  appendComposerText: (text: string, opts?: { separator?: string }) => void;
  consumePendingComposerAppend: (targetSessionId: string) => PendingComposerAppend | null;
  requestComposerFocus: (targetSessionId?: string) => void;

  // 컨텍스트 블록 관리
  setContextBlocks: (blockIds: string[]) => void;
  addContextBlock: (blockId: string) => void;
  removeContextBlock: (blockId: string) => void;

  // 세션 제한 헬퍼
  isSessionLimitReached: () => boolean;
  getOldestSession: () => ChatSession | null;

  // 유틸리티
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  setTranslationRules: (rules: string) => void;
  /** @returns 실제로 추가된 항목이 있으면 true (전부 중복이면 false) */
  appendToTranslationRules: (snippet: string) => boolean;
  setWebSearchEnabled: (enabled: boolean) => void;
  setConfluenceSearchEnabled: (enabled: boolean, targetSessionId?: string) => void;
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
  /**
   * debounce 타이머를 취소하고 즉시 저장합니다 (Safe Exit 등).
   * projectId 재검증은 persistNow 내부(loadedProjectId/isHydrating 검사)에서 수행됩니다.
   */
  flushPersist: () => Promise<void>;

  // Streaming 상태 관리 (성능 최적화: 배열 갱신 없이 단일 필드만 업데이트)
  setStreamingContent: (content: string) => void;
  setStreamingMetadata: (metadata: ChatMessage['metadata']) => void;
  /**
   * 스트리밍 내용을 메시지 배열에 커밋합니다.
   * assistantId를 명시 전달하면 현재 streamingMessageId와 일치할 때만 커밋합니다 (L1 소유권 가드).
   */
  finalizeStreaming: (assistantId?: string) => void;
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
