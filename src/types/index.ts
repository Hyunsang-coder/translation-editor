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
  /**
   * 스냅샷 종류. 'auto'는 프로젝트당 1개뿐인 자동 저장 슬롯이다.
   * description은 사용자가 rename으로 바꿀 수 있으므로 종류 판별에 쓰지 않는다.
   */
  kind: HistorySnapshotKind;
}

export type HistorySnapshotKind = 'manual' | 'auto';

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
   * 이 세션에 고정(pin)된 provider (`'anthropic' | 'openai'`).
   * - v13 이전 세션에는 `claude-sonnet-5` 같은 프리셋 ID가 들어 있다. hydrate가
   *   `normalizeProvider`로 고쳐 쓰므로 store 안에서는 항상 provider 값이다.
   * - 값이 없으면(레거시) 전역 aiConfigStore.provider를 상속한다.
   * - DB 컬럼명은 `model_preset` 그대로다(값 의미만 바뀜, ADR-0012).
   */
  modelPreset?: string;
  /**
   * 장기 대화 working context (Phase 3).
   * - 전체 transcript(messages)는 그대로 보존하고, 오래된 구간은 이 요약으로 압축해
   *   모델 입력 토큰 예산을 지킨다.
   * - 값이 없으면 아직 요약이 생성되지 않은 세션이다.
   */
  memory?: ChatSessionMemory;
}

/**
 * 장기 대화 누적 요약 상태 (Phase 3).
 * transcript(messages)를 대체하지 않으며, 모델 입력용 working context 조립에만 쓰인다.
 */
export interface ChatSessionMemory {
  /** 오래된 대화 구간의 누적 요약 텍스트 */
  summary: string;
  /** 요약에 반영된 마지막 메시지 ID (이 이후 메시지만 다음 증분 요약 대상) */
  summarizedThroughMessageId: string | null;
  /** 마지막 요약 생성 시각(ms) */
  summaryUpdatedAt: number | null;
  /** 요약 생성에 사용한 모델 ID (관측/디버깅) */
  summaryModel: string | null;
  /** 요약 스키마 버전 (호환 마이그레이션용) */
  summaryVersion: number;
}

export type SelectionPanel = 'source' | 'target';

export type SelectionAnchorStatus =
  | 'active'
  | 'stale'
  | 'detached'
  | 'applied'
  | 'dismissed';

export interface SelectionContext {
  selectionId: string;
  selectionScopeId: string;
  projectId: string;
  panel: SelectionPanel;
  text: string;
  from: number;
  to: number;
  anchorId: string;
  translationUnitIds: string[];
  segmentGroupId?: string;
  documentRevision: string;
  status: SelectionAnchorStatus;
  /**
   * 문단을 가로지르는 선택. 채팅 참조로는 쓸 수 있지만 재번역·수정안 적용은
   * 막힌다(평문 교체로 블록 구조가 뭉개짐 — `applySelectionEdit` 참고).
   */
  spansMultipleBlocks: boolean;
  createdAt: number;
}

export interface ChatSelectionSnapshot {
  selectionId: string;
  selectionScopeId: string;
  projectId: string;
  panel: SelectionPanel;
  text: string;
  translationUnitIds: string[];
  documentRevision: string;
  anchorStatusAtSend: SelectionAnchorStatus;
}

export interface ContextReferenceOptions {
  translationRules: boolean;
  forbiddenTerms: boolean;
  glossary: boolean;
  projectContext: boolean;
}

/**
 * 부분 수정의 기본 참조 범위.
 *
 * 번역 규칙과 금칙어는 모든 문장에 적용되는 전역 제약이고 크기도 작아 기본으로 켠다.
 * 이 둘이 빠진 채 생성된 수정안은 문장으로는 멀쩡해 보여서 문서 내 불일치를 조용히
 * 만들어낸다. 반면 용어집과 프로젝트 메모리는 크고 질의에 따라 필요한 것이 달라지므로
 * 사용자가 필요할 때 켜도록 둔다.
 */
export const DEFAULT_SELECTION_REFERENCE_OPTIONS: ContextReferenceOptions = {
  translationRules: true,
  forbiddenTerms: true,
  glossary: false,
  projectContext: false,
};

export type ProjectMemoryCategory =
  | 'domain'
  | 'audience'
  | 'product'
  | 'worldbuilding'
  | 'character'
  | 'intent'
  | 'decision'
  | 'reference_fact'
  | 'general';

export type ProjectMemoryStatus = 'proposed' | 'active';

export interface ProjectMemoryItem {
  id: string;
  projectId: string;
  category: ProjectMemoryCategory;
  content: string;
  normalizedHash: string;
  status: ProjectMemoryStatus;
  source: 'user' | 'chat' | 'review' | 'import' | 'legacy';
  sourceSessionId?: string;
  sourceMessageId?: string;
  sourceSelectionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ForbiddenTerm {
  id: string;
  projectId: string;
  term: string;
  replacement?: string;
  note?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type WorkflowContextMode =
  | 'general-chat'
  | 'selection-chat'
  | 'full-translate'
  | 'selection-retranslate'
  | 'review'
  | 'polish';

export interface ContextSnapshot {
  revision: number;
  /**
   * `source`는 상한 절단 시 사용자 직접 입력을 우선 보존하는 데 쓴다.
   * 이 필드가 생기기 전에 저장된 스냅샷에는 없으므로 optional이다.
   */
  projectMemoryItems: Array<
    Pick<ProjectMemoryItem, 'id' | 'category' | 'content'>
    & Partial<Pick<ProjectMemoryItem, 'source'>>
  >;
  translationRules: string;
  forbiddenTerms: Array<Pick<ForbiddenTerm, 'id' | 'term' | 'replacement' | 'note'>>;
  glossaryEntries: Array<{
    id: string;
    source: string;
    target: string;
    /** 동음이의 판단 근거. 주입 시 항목당 상한이 적용된다(resolveWorkflowContext). */
    notes?: string;
  }>;
  createdAt: number;
}

export type ContextManifestInclude =
  | 'selection'
  | 'aligned-source'
  | 'translation-rules'
  | 'forbidden-terms'
  | 'glossary'
  | 'project-memory'
  | 'chat-summary'
  | 'document-tool'
  | 'external-tool';

export interface ContextManifest {
  mode: WorkflowContextMode;
  revision: number;
  projectMemoryItemIds: string[];
  translationRulesHash?: string;
  forbiddenTermIds: string[];
  glossaryEntryIds: string[];
  included: ContextManifestInclude[];
  estimatedInputTokens?: number;
}

export interface ResolvedWorkflowContext {
  snapshot: ContextSnapshot;
  manifest: ContextManifest;
  rendered: {
    projectMemory?: string;
    translationRules?: string;
    forbiddenTerms?: string;
    glossary?: string;
  };
}

export interface SelectionEditProposal {
  proposalId: string;
  selectionId: string;
  selectionScopeId: string;
  projectId: string;
  panel: 'target';
  anchorId: string;
  originalText: string;
  replacementText: string;
  explanation?: string;
  operation: 'translate' | 'polish' | 'rewrite';
  documentRevisionAtRequest: string;
  contextManifest?: ContextManifest;
  status: 'proposed' | 'previewing' | 'applied' | 'stale' | 'dismissed';
  createdAt: number;
  appliedAt?: number;
}

export interface ProjectMemoryChangeProposal {
  proposalId: string;
  /** 제안이 생성된 프로젝트. 적용 시점에 프로젝트가 바뀌었는지 검증한다. */
  projectId?: string;
  /** `archive`는 삭제 시맨틱으로 통일되기 전의 legacy 값으로, 읽기 시 `delete`로 정규화한다. */
  operation: 'add' | 'replace' | 'delete';
  category: ProjectMemoryCategory;
  content?: string;
  targetItemId?: string;
  reason?: string;
  sourceSessionId: string;
  sourceMessageId?: string;
  status: 'proposed' | 'applied' | 'dismissed';
}

export interface ForbiddenTermProposal {
  proposalId: string;
  /** 제안이 생성된 프로젝트. 적용 시점에 프로젝트가 바뀌었는지 검증한다. */
  projectId?: string;
  term: string;
  replacement?: string;
  note?: string;
  status: 'proposed' | 'applied' | 'dismissed';
}

export interface GlossaryEntryProposal {
  proposalId: string;
  /** 제안이 생성된 프로젝트. 적용 시점에 프로젝트가 바뀌었는지 검증한다. */
  projectId?: string;
  source: string;
  target: string;
  notes?: string;
  status: 'proposed' | 'applied' | 'dismissed';
}

export type ChatContextMode = 'general' | 'selection' | 'document';

export type ChatToolProfile =
  | 'general'
  | 'selection-source'
  | 'selection-target'
  | 'selection-retranslate';

export type ChatToolRequirement =
  | 'project'
  | 'source-selection'
  | 'target-selection'
  | 'review-results'
  | 'web-enabled'
  | 'confluence-enabled';

export interface ChatToolDescriptor {
  name: string;
  profiles: ChatToolProfile[];
  effect: 'read' | 'external-read' | 'proposal' | 'document-write';
  trust: 'internal' | 'document' | 'external';
  maxOutputChars: number;
  displayNameKey: string;
  requires?: ChatToolRequirement[];
}

export interface SendMessageOptions {
  targetSessionId?: string;
  contextMode?: ChatContextMode;
  selection?: SelectionContext;
  selectionScopeId?: string;
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

  /**
   * @deprecated v13 이전 메시지에만 있는 프리셋 ID. provider 단일 선택으로 바뀌면서
   * `provider` 필드와 값이 겹쳐 새로 쓰지 않는다. 읽는 쪽은 `normalizeProvider`를 통과시킬 것.
   */
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
  /** 이번 턴(도구 루프 합산)에서 캐시로부터 읽은 입력 토큰 (~0.1× 과금) */
  cacheReadInputTokens?: number;
  /** 이번 턴(도구 루프 합산)에서 캐시에 새로 기록한 입력 토큰 (1.25× 과금) */
  cacheCreationInputTokens?: number;
  /** context window 사용률 (0~1, Phase 3에서 채워짐) */
  contextUtilization?: number;

  /** 이번 응답 생성 과정에서 호출된 Tool 목록(디버깅/가시화) */
  toolsUsed?: string[];
  /**
   * 현재 실행 중인 Tool 목록 (UX: "툴 실행 중" 표시)
   * - 실시간 표시를 위한 상태이며, 최종 toolsUsed와는 별개입니다.
   */
  toolCallsInProgress?: string[];

  selection?: ChatSelectionSnapshot;
  selectionScopeId?: string;
  documentEditProposal?: SelectionEditProposal;
  contextManifest?: ContextManifest;

  /**
   * 한 응답에서 제안된 프로젝트 지식 변경들.
   * - 모델이 여러 건을 제안할 수 있으므로 배열로 누적한다.
   */
  projectMemoryProposals?: ProjectMemoryChangeProposal[];
  forbiddenTermProposals?: ForbiddenTermProposal[];
  glossaryEntryProposals?: GlossaryEntryProposal[];

  /**
   * @deprecated 2026-07-27 — `projectMemoryProposals` 사용. 과거 메시지 hydrate 호환용.
   */
  projectMemoryProposal?: ProjectMemoryChangeProposal;
  /**
   * @deprecated 2026-07-27 — `forbiddenTermProposals` 사용. 과거 메시지 hydrate 호환용.
   */
  forbiddenTermProposal?: ForbiddenTermProposal;
  /**
   * @deprecated 2026-07-27 — `glossaryEntryProposals` 사용. 과거 메시지 hydrate 호환용.
   */
  glossaryEntryProposal?: GlossaryEntryProposal;

  /**
   * Add to Rules 버튼을 이미 눌렀는지 여부
   * - 중복 append 방지 및 버튼 숨김 용도
   */
  rulesAdded?: boolean;

  /**
   * @deprecated 2026-07-27 — [Add to Context] 제거됨. 과거 메시지 hydrate 호환용으로만 남긴다.
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
   * @deprecated 2026-07-27 — 승인 기반 Project Memory(`propose_project_memory_change`)로 대체됨.
   * 더 이상 생성/표시하지 않으며 과거 메시지 hydrate 호환용으로만 남긴다.
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
}

/**
 * 알림/토스트 메시지
 */
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}
