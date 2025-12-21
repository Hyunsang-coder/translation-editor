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
  sourceLanguage: string;
  targetLanguage: string;
  domain: ProjectDomain;
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
  suggestedBlockId?: string; // Apply 시 대상 블록
  appliedAt?: number;
  accepted?: boolean;

  /**
   * 이 메시지가 "Apply 가능한 번역 제안"인지 여부.
   * true인 경우에만 UI에서 Apply 버튼을 노출합니다.
   */
  appliable?: boolean;

  /**
   * Apply 시 "선택 구간"만 대체하는 경우, 선택 텍스트(plain)를 함께 저장합니다.
   */
  selectionText?: string;

  /**
   * Target 단일 문서(Monaco)에서의 selection 위치(UTF-16 offset)
   * - Range tracking은 이후 단계에서 고도화(Tracked range)합니다.
   */
  selectionStartOffset?: number;
  selectionEndOffset?: number;

  /**
   * 태그/변수 무결성 검증 실패 등으로 Apply를 막는 경우 사유를 기록합니다.
   * - UI에서 사용자에게 안내용으로 노출
   */
  applyBlockedReason?: string;
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

