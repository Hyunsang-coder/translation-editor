/**
 * OddEyes.ai Core Types
 * (Internal codename: ITE / Integrated Translation Editor)
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
  snapshotJson?: string;
}

/**
 * 히스토리 메타데이터 (목록용 경량 타입)
 */
export interface HistorySnapshotMeta {
  id: string;
  timestamp: number;
  description: string;
  chatSummary?: string;
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
  /**
   * 이 세션의 채팅 모델 프리셋 ID (세션 단위 모델 선택).
   * - 값이 없으면(레거시/마이그레이션) 전역 chatModel 기본값을 상속한다.
   * - 전역 aiConfigStore.chatModel은 "새 세션 기본값"으로만 사용된다.
   */
  modelPreset?: string;
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
  /**
   * @deprecated 레거시 필드. 마이그레이션 호환을 위해 읽기는 지원하되,
   * 새 쓰기에서는 resolvedModel/requestedModelPreset/provider로 대체한다.
   */
  model?: string;
  tokens?: number;

  /** 사용자가 선택한 모델 프리셋 ID (세션 modelPreset 또는 전역 기본값 스냅샷) */
  requestedModelPreset?: string;
  /** 실제 호출에 사용된 API 모델 ID (배지 표시 소스) */
  resolvedModel?: string;
  /** 실제 호출 provider */
  provider?: 'openai' | 'anthropic';
  /** 추론 강도 (해당되는 경우) */
  reasoningEffort?: string;
  /** 실제 소비된 입력 토큰 수 */
  inputTokens?: number;
  /** 실제 소비된 출력 토큰 수 */
  outputTokens?: number;
  /** 실제 소비된 총 토큰 수 */
  totalTokens?: number;
  /** context window 사용률 (0~1, Phase 3에서 채워짐) */
  contextUtilization?: number;

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
   * AI가 제안한 번역 규칙 (suggest_translation_rule Tool Call 결과)
   * - 이 필드가 존재하면 UI에 [Add to Rules] 버튼이 표시됩니다.
   */
  suggestedRule?: string;

  /**
   * AI가 제안한 프로젝트 컨텍스트 (suggest_project_context Tool Call 결과)
   * - 이 필드가 존재하면 UI에 [Add to Context] 버튼이 표시됩니다.
   */
  suggestedContext?: string;

  /**
   * 사용자 메시지에 첨부된 이미지 (채팅 UI 표시용)
   * - 전송 시점에 캡처되어 메시지에 저장됨
   * - thumbnailDataUrl은 base64 data URL로 저장되어 세션 간 유지됨
   */
  imageAttachments?: {
    filename: string;
    thumbnailDataUrl: string;
  }[];
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
  glossaryId?: string;
  source: string;
  target: string;
  notes?: string | null;
  domain?: ProjectDomain | string | null;
  caseSensitive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 저장된 용어집 요약
 */
export interface GlossarySummary {
  id: string;
  name: string;
  description?: string | null;
  entryCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 현재 프로젝트에 연결된 용어집
 */
export interface ProjectGlossary extends GlossarySummary {
  priority: number;
}

/**
 * 용어집 상세
 */
export interface Glossary extends GlossarySummary {
  entries: GlossaryEntry[];
}

// ============================================
// UI State Types
// ============================================

/**
 * 고정 패널 타입 (settings, review, comments)
 */
export type FixedPanelType = 'settings' | 'review' | 'comments';

/**
 * 채팅 패널 타입 — 세션 ID를 포함하는 template literal
 * e.g. 'chat:abc-123-def'
 */
export type ChatPanelType = `chat:${string}`;

/**
 * 패널 타입 (도킹 모델)
 * 고정 패널 또는 채팅 세션 패널
 */
export type PanelType = FixedPanelType | ChatPanelType;

// --- PanelType Runtime Helpers ---

export function isFixedPanel(panel: PanelType): panel is FixedPanelType {
  return panel === 'settings' || panel === 'review' || panel === 'comments';
}

export function isChatPanel(panel: PanelType): panel is ChatPanelType {
  return panel.startsWith('chat:');
}

export function getChatSessionId(panel: PanelType): string | null {
  if (!isChatPanel(panel)) return null;
  return panel.slice(5); // 'chat:'.length === 5
}

export function chatPanelId(sessionId: string): ChatPanelType {
  return `chat:${sessionId}`;
}

/**
 * 사이드바 위치 타입
 */
export type SidebarSide = 'left' | 'right';

/**
 * 도킹 사이드바 상태
 * panels 배열에 도킹된 패널 목록을 순서대로 유지
 */
export interface DockingSidebarState {
  hidden: boolean;              // 폭 0으로 완전 숨김 (접힘 아이콘 레일 개념 제거)
  panels: PanelType[];          // 이 사이드에 도킹된 패널 목록 (순서 유지)
  activePanel: PanelType | null; // 현재 보이는 패널
  width: number;                // px, 200-600
}

/**
 * 앱 내부 플로팅 채팅 패널의 위치와 크기.
 * MainLayout의 콘텐츠 영역을 기준으로 한 CSS px 좌표입니다.
 */
export interface FloatingChatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * DnD dataTransfer용
 */
export interface PanelDragData {
  panelType: PanelType;
  sourceSide: SidebarSide;
}

/** @deprecated Use PanelType instead */
export type SidebarTab = PanelType;

/**
 * 에디터 UI 상태
 */
export interface EditorUIState {
  focusMode: boolean;
  sourceOnlyMode: boolean;
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
