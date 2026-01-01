/**
 * ITE (Integrated Translation Editor) Core Types
 * N:M 매핑 구조 기반의 타입 정의
 */

// ============================================
// Project Types
// ============================================

/**
 * 프로젝트 전체 구조
 * 모든 번역 프로젝트의 루트 인터페이스
 */
export interface ITEProject {
  id: string;
  version: string; // 데이터 스키마 버전
  metadata: ProjectMetadata;
  segments: SegmentGroup[]; // N:M 매핑의 핵심 단위
  blocks: Record<string, EditorBlock>; // 실제 텍스트 데이터 보관소 (ID 기반)
  history: HistorySnapshot[];
}

/**
 * 프로젝트 메타데이터
 */
export interface ProjectMetadata {
  title: string;
  description?: string;
  domain: ProjectDomain;
  targetLanguage?: string; // 타겟 언어 (선택 사항)
  createdAt: number;
  updatedAt: number;
  author?: string;
  glossaryPaths?: string[];
  settings: ProjectSettings;
}

/**
 * 프로젝트 도메인 (워크플로우 프리셋)
 */
export type ProjectDomain =
  | 'game'
  | 'it'
  | 'legal'
  | 'marketing'
  | 'medical'
  | 'general';

/**
 * 프로젝트 설정
 */
export interface ProjectSettings {
  strictnessLevel: number; // 0~1: AI가 규칙을 얼마나 엄격하게 따를지
  autoSave: boolean;
  autoSaveInterval: number; // milliseconds
  theme: 'light' | 'dark' | 'system';
}

// ============================================
// Segment & Block Types
// ============================================

/**
 * 원문-번역문 연결 그룹
 * N:M 관계의 핵심 단위
 */
export interface SegmentGroup {
  groupId: string;
  sourceIds: string[]; // 원문 블록 ID 리스트 (보통 1개)
  targetIds: string[]; // 번역 블록 ID 리스트 (엔터로 쪼개질 수 있음)
  isAligned: boolean;
  order: number; // 표시 순서
}

/**
 * 개별 블록 데이터
 */
export interface EditorBlock {
  id: string;
  type: BlockType;
  content: string; // HTML(TipTap) 또는 JSON Content
  hash: string; // 변경 감지용
  metadata: BlockMetadata;
}

/**
 * 블록 타입
 */
export type BlockType = 'source' | 'target';

/**
 * 블록 메타데이터
 */
export interface BlockMetadata {
  author?: string;
  createdAt: number;
  updatedAt: number;
  tags: string[]; // {user} 등의 변수 인덱스
  comments?: BlockComment[];
}

/**
 * 블록 코멘트
 */
export interface BlockComment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  resolved: boolean;
}

// ============================================
// History Types
// ============================================

/**
 * 히스토리 스냅샷
 */
export interface HistorySnapshot {
  id: string;
  timestamp: number;
  description: string;
  blockChanges: BlockChange[];
  chatSummary?: string; // 해당 시점의 AI 대화 요약
}

/**
 * 블록 변경 기록
 */
export interface BlockChange {
  blockId: string;
  previousContent: string;
  newContent: string;
  type: 'create' | 'update' | 'delete' | 'split' | 'merge';
}

// ============================================
// Chat Types
// ============================================

/**
 * 채팅 세션
 */
export interface ChatSession {
  id: string;
  name: string;
  createdAt: number;
  messages: ChatMessage[];
  contextBlockIds: string[]; // 관련 블록 ID들
  confluenceSearchEnabled?: boolean; // Rovo MCP 검색 사용 여부 (탭 단위)
}

/**
 * 채팅 메시지
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: ChatMessageMetadata;
}

/**
 * 채팅 메시지 메타데이터
 */
export interface ChatMessageMetadata {
  model?: string;
  tokens?: number;
  /** 이번 응답 생성 과정에서 호출된 Tool 목록(디버깅/가시화) */
  toolsUsed?: string[];
  /**
   * 현재 실행 중인 Tool 목록 (UX: "툴 실행 중" 표시)
   * - 실시간 표시를 위한 상태이며, 최종 toolsUsed와는 별개입니다.
   */
  toolCallsInProgress?: string[];

  /**
   * Add to Rules 버튼을 이미 눌렀는지 여부
   * - 중복 append 방지 및 버튼 숨김 용도
   */
  rulesAdded?: boolean;

  /**
   * Add to Context 버튼을 이미 눌렀는지 여부
   * - 중복 append 방지 및 버튼 숨김 용도
   */
  contextAdded?: boolean;

  /**
   * 메시지 수정 이력 (TRD 4.3 권장)
   * - 사용자가 메시지를 수정하면 해당 메시지 이후 대화는 truncate됩니다.
   */
  editedAt?: number;
  originalContent?: string;

  /**
   * AI가 제안한 규칙/메모리 (Tool Call 결과)
   * - 이 필드가 존재하면 UI에 [Add to Rules] 또는 [Add to Context] 버튼이 표시됩니다.
   */
  suggestion?: {
    /**
     * - rule: Translation Rules에 추가
     * - context: Project Context에 추가
     * - both: 둘 다 제안 (사용자가 선택)
     */
    type: 'rule' | 'context' | 'both';
    content: string;
  };
}

// ============================================
// Diff Types
// ============================================

/**
 * Diff 결과
 */
export interface DiffResult {
  blockId: string;
  original: string;
  suggested: string;
  changes: DiffChange[];
  status: 'pending' | 'accepted' | 'rejected';
}

/**
 * 개별 Diff 변경
 */
export interface DiffChange {
  type: 'insert' | 'delete' | 'equal';
  value: string;
  start: number;
  end: number;
}

// ============================================
// Edit Session Types
// ============================================

export type EditSessionStatus = 'pending' | 'kept' | 'discarded';

export interface EditSession {
  id: string;
  createdAt: number;
  kind: 'edit' | 'translate';
  target: 'targetDocument';
  anchorRange: {
    startOffset: number;
    endOffset: number;
  };
  baseText: string;
  suggestedText: string;
  diff: DiffResult;
  status: EditSessionStatus;
  sourceContext?: string;
  originMessageId?: string;
}

// ============================================
// Glossary Types
// ============================================

/**
 * 용어집 항목
 */
export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  notes?: string;
  domain?: ProjectDomain;
  caseSensitive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 용어집
 */
export interface Glossary {
  id: string;
  name: string;
  entries: GlossaryEntry[];
  createdAt: number;
  updatedAt: number;
}

// ============================================
// UI State Types
// ============================================

/**
 * 에디터 UI 상태
 */
export interface EditorUIState {
  focusMode: boolean;
  activePanel: 'source' | 'target' | 'chat';
  selectedBlockId: string | null;
  showDiff: boolean;
  sidebarCollapsed: boolean;
  projectSidebarCollapsed: boolean;
}

/**
 * 알림/토스트 메시지
 */
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

