import { create } from 'zustand';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ITEProject } from '@/types';
import { buildAlignedChunksAsync, clearReviewChunkCache, type AlignedChunk } from '@/ai/tools/reviewTool';
import { stripRichTextMarkup } from '@/utils/normalizeForSearch';

// ============================================
// Review Settings Types
// ============================================

// ============================================
// Review Result Types
// ============================================

/** 이슈 타입 (Two-Pass Review) */
export type IssueType =
  | 'omission'       // 원문 의미가 번역에서 온전히 전달되지 않음
  | 'addition'       // 원문에 없는 내용 추가
  | 'mistranslation' // 의미 오역, 수치/고유명사 오류
  | 'grammar'        // 문법 오류 (단복수, 관사, 시제 등)
  | 'awkward'        // 직역투 부자연스러운 표현
  | 'terminology';   // 프로젝트 글로서리/표준 용어와 불일치

/** 이슈 심각도 */
export type IssueSeverity = 'critical' | 'major' | 'minor';

/**
 * 결정적 ID 생성 (중복 제거 + 체크 상태 유지용)
 * 간단한 해시 구현 - 브라우저에서 동작
 */
// djb2 32-bit: collision probability negligible at review scale (~100 issues)
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * ReviewIssue에 대한 결정적 ID 생성
 */
export function generateIssueId(
  segmentOrder: number,
  type: string,
  sourceExcerpt: string,
  targetExcerpt: string,
): string {
  return hashContent(`${segmentOrder}|${type}|${sourceExcerpt}|${targetExcerpt}`);
}

export interface ReviewIssue {
  id: string;                    // 결정적 ID (중복 제거/상태 유지용)
  segmentOrder: number;
  segmentGroupId: string | undefined;  // 세그먼트 단위 하이라이트용
  sourceExcerpt: string;         // 원문 구절
  targetExcerpt: string;         // 현재 번역 (하이라이트 대상)
  suggestedFix: string;          // 수정 제안 (참고용)
  type: IssueType;
  severity: IssueSeverity;       // 심각도 (critical/major/minor)
  description: string;
  checked: boolean;              // 체크 상태
}

export interface ReviewResult {
  chunkIndex: number;
  issues: ReviewIssue[];
  error?: string;
}

interface ReviewActionHistoryBase {
  actionId: string;
  issueId: string;
  projectId: string;
  state: 'resolved' | 'undone';
}

/** 한 문장 적용과 ProseMirror undo/redo 경계를 연결하는 세션 내 기록. */
export interface AppliedSuggestionHistoryEntry extends ReviewActionHistoryBase {
  kind: 'applied';
  beforeDoc: ProseMirrorNode;
  afterDoc: ProseMirrorNode;
}

/** 문서를 변경하지 않고 검수 항목을 무시한 세션 내 기록. */
export interface IgnoredIssueHistoryEntry extends ReviewActionHistoryBase {
  kind: 'ignored';
}

export type ReviewActionHistoryEntry = AppliedSuggestionHistoryEntry | IgnoredIssueHistoryEntry;
export type AppliedSuggestionHistoryTransition = 'undone' | 'redone' | null;

// ============================================
// Review Store State
// ============================================

interface ReviewState {
  // severity 필터 (기본: Critical + Major 표시)
  severityFilter: IssueSeverity[];

  // 검수 실행 상태
  chunks: AlignedChunk[];
  currentChunkIndex: number;
  results: ReviewResult[];
  isReviewing: boolean;
  progress: { completed: number; total: number };
  highlightEnabled: boolean;  // 하이라이트 활성화 여부
  highlightNonce: number;     // 하이라이트 업데이트 트리거 (nonce 증가 시 재계산)
  initializedProjectId: string | null;  // 초기화된 프로젝트 ID (탭 전환 시 상태 유지)
  totalIssuesFound: number;  // 검수 완료 시점의 총 이슈 수 (UI 메시지 분기용)
  streamingText: string;  // 현재 청크의 AI 스트리밍 응답 텍스트
  resolvedIssueIds: string[]; // 적용 또는 무시되어 현재 결과 목록/하이라이트에서 숨긴 이슈
  reviewActionHistory: ReviewActionHistoryEntry[]; // 적용/무시 및 되돌리기를 순서대로 기록
  /**
   * 외부(툴바)에서 온 검수 시작 요청. ReviewPanel이 소비(consume)하면 null로 돌아간다.
   *
   * nonce가 아니라 요청 객체인 이유: 툴바는 패널을 열면서 동시에 실행을 요청하는데,
   * 그 순간 ReviewPanel은 아직 마운트 전이라 nonce 증가를 관측할 수 없다
   * (마운트 시점의 값이 그대로 "이전 값"이 됨). 요청이 상태로 남아 있으면
   * 새로 마운트된 패널도 첫 effect에서 집어갈 수 있다.
   */
  pendingReviewRun: { instruction: string } | null;
}

interface ReviewActions {
  /**
   * 검수 초기화: 프로젝트를 청크로 분할하고 상태 초기화
   * 비동기 처리로 메인 스레드 블로킹 방지
   */
  initializeReview: (project: ITEProject) => Promise<void>;

  /**
   * 검수 결과 추가
   */
  addResult: (result: ReviewResult) => void;

  /**
   * 청크 에러 처리
   */
  handleChunkError: (chunkIndex: number, error: Error) => void;

  /**
   * 검수 실행 슬롯 원자적 획득 (이중 실행 방지, L4).
   * 이미 검수 중이면 false를 반환하고, 아니면 isReviewing을 즉시 true로 만든다.
   * chunk 빌드 등 비동기 준비 단계보다 먼저 호출해 이중 실행 창을 제거한다.
   * 획득 후 startReview에 도달하지 못하면 releaseReviewRun으로 반납해야 한다.
   */
  acquireReviewRun: (projectId: string) => boolean;

  /**
   * acquireReviewRun으로 획득한 실행 슬롯을 검수 시작 전에 반납 (준비 단계 실패/중단 시).
   */
  releaseReviewRun: () => void;

  /**
   * 검수 시작 상태로 전환
   */
  startReview: (chunksOverride?: AlignedChunk[]) => void;

  /**
   * 검수 완료 상태로 전환
   */
  finishReview: () => void;

  /**
   * 검수 상태 초기화
   */
  resetReview: () => void;

  /**
   * 외부에서 검수 시작 요청 (ReviewPanel이 감지하여 실행)
   * @param instruction 이번 실행에만 적용할 추가 지시사항 (빈 문자열이면 없음)
   */
  requestReviewRun: (instruction?: string) => void;

  /**
   * 대기 중인 검수 시작 요청을 가져가면서 비운다 (ReviewPanel 전용).
   * 요청이 없으면 null.
   */
  consumePendingReviewRun: () => { instruction: string } | null;

  /**
   * 특정 청크 가져오기
   */
  getChunk: (chunkIndex: number) => AlignedChunk | null;

  /**
   * 모든 이슈 가져오기 (중복 제거됨)
   */
  getAllIssues: () => ReviewIssue[];

  /**
   * 이슈 체크 상태 토글
   */
  toggleIssueCheck: (issueId: string) => void;

  /** 문서는 바꾸지 않고 이슈를 무시 상태로 숨긴다. 성공 시 고유 작업 ID를 반환한다. */
  ignoreIssue: (params: { issueId: string; projectId: string }) => string | null;

  /** 고유 작업 ID에 해당하는 무시만 되돌린다. */
  undoIgnoredIssue: (actionId: string) => boolean;

  /**
   * 한 문장 적용을 해결 처리하고 undo/redo 동기화용 문서 경계를 기록
   */
  recordAppliedSuggestion: (
    entry: Omit<AppliedSuggestionHistoryEntry, 'actionId' | 'kind' | 'state'>,
  ) => string | null;

  /**
   * editor transaction이 기록된 적용의 undo/redo인지 판별하여 이슈 해결 상태와 동기화
   */
  reconcileAppliedSuggestionTransaction: (params: {
    projectId: string;
    beforeDoc: ProseMirrorNode;
    afterDoc: ProseMirrorNode;
  }) => AppliedSuggestionHistoryTransition;

  /**
   * 모든 이슈 체크 상태 설정
   */
  setAllIssuesChecked: (checked: boolean) => void;

  /**
   * 체크된 이슈만 가져오기
   */
  getCheckedIssues: () => ReviewIssue[];

  /**
   * 하이라이트 표시 토글
   */
  toggleHighlight: () => void;

  /**
   * 하이라이트 비활성화
   */
  disableHighlight: () => void;

  /**
   * 하이라이트 새로고침 (nonce 증가)
   */
  refreshHighlight: () => void;

  /**
   * severity 필터 토글
   */
  toggleSeverityFilter: (severity: IssueSeverity) => void;

  /**
   * 필터링된 이슈 가져오기 (severityFilter 적용)
   */
  getFilteredIssues: () => ReviewIssue[];

  /**
   * 스트리밍 텍스트 업데이트
   */
  setStreamingText: (text: string) => void;

  /**
   * 외부(MCP) 검수 결과 주입: 기존 results를 1회 전체 교체하고 하이라이트 즉시 활성화.
   * initializeReview 경합(함정 2)·severityFilter 경합(함정 4) 방지를 한 set()에서 처리.
   */
  ingestExternalReview: (params: {
    projectId: string;
    issues: Array<{
      segmentOrder?: number;
      segmentGroupId?: string;
      sourceExcerpt: string;
      targetExcerpt: string;
      suggestedFix?: string;
      type: IssueType;
      severity: IssueSeverity;
      description: string;
    }>;
  }) => void;
}

type ReviewStore = ReviewState & ReviewActions;

// ============================================
// getAllIssues Cache (store 외부에서 관리)
// ============================================

let cachedAllIssues: ReviewIssue[] = [];
let cachedNonce: number = -1;
// 적용 이력은 TipTap history depth와 맞추고, 무시는 별도 한도를 사용한다.
// 무시가 많아도 editor undo/redo와 연결된 적용 이력을 밀어내면 안 된다.
// 창 밖으로 밀린 작업의 resolvedIssueIds는 유지되어 처리한 항목이 다시 나타나지 않는다.
const MAX_REVIEW_ACTION_HISTORY_PER_KIND = 100;
let reviewActionSequence = 0;

function createReviewActionId(kind: ReviewActionHistoryEntry['kind']): string {
  reviewActionSequence += 1;
  return `${kind}-${reviewActionSequence}`;
}

function reconcileResolvedIssueId(
  resolvedIssueIds: string[],
  history: ReviewActionHistoryEntry[],
  issueId: string,
): string[] {
  const remainsResolved = history.some((entry) =>
    entry.issueId === issueId && entry.state === 'resolved',
  );
  if (remainsResolved) {
    return resolvedIssueIds.includes(issueId) ? resolvedIssueIds : [...resolvedIssueIds, issueId];
  }
  return resolvedIssueIds.filter((id) => id !== issueId);
}

function trimReviewActionHistory(history: ReviewActionHistoryEntry[]): ReviewActionHistoryEntry[] {
  let appliedCount = 0;
  let ignoredCount = 0;
  const kept: ReviewActionHistoryEntry[] = [];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!;
    if (entry.kind === 'applied') {
      if (appliedCount >= MAX_REVIEW_ACTION_HISTORY_PER_KIND) continue;
      appliedCount += 1;
    } else {
      if (ignoredCount >= MAX_REVIEW_ACTION_HISTORY_PER_KIND) continue;
      ignoredCount += 1;
    }
    kept.push(entry);
  }

  return kept.reverse();
}

// initializeReview 경합 가드: A→B 빠른 전환 시 늦게 끝난 A의 set이 B 상태를 덮지 않도록
// (projectStore hydrateCommentsForProject의 requestSeq 패턴과 동일)
let initializeReviewRequestSeq = 0;

// ============================================
// Store Implementation
// ============================================

const initialState: ReviewState = {
  // severity 필터 기본값: 전체 표시
  severityFilter: ['critical', 'major', 'minor'] as IssueSeverity[],

  // 검수 실행 상태 기본값
  chunks: [],
  currentChunkIndex: 0,
  results: [],
  isReviewing: false,
  progress: { completed: 0, total: 0 },
  highlightEnabled: false,
  highlightNonce: 0,
  initializedProjectId: null,
  totalIssuesFound: 0,
  streamingText: '',
  resolvedIssueIds: [],
  reviewActionHistory: [],
  pendingReviewRun: null,
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
  ...initialState,

  initializeReview: async (project: ITEProject) => {
    const { initializedProjectId, results } = get();
    // 이미 같은 프로젝트로 초기화되어 있고 검수 결과가 있으면 스킵 (탭 전환 시 상태 유지)
    // 검수 결과가 없으면 항상 재초기화 (resetReview 후 또는 첫 진입)
    if (initializedProjectId === project.id && results.length > 0) {
      return;
    }
    const requestSeq = ++initializeReviewRequestSeq;
    // 비동기 청킹으로 메인 스레드 블로킹 방지
    const chunks = await buildAlignedChunksAsync(project);
    // 늦게 도착한 stale 초기화가 더 최신 초기화 결과를 덮지 않도록 가드
    if (requestSeq !== initializeReviewRequestSeq) return;
    // 이 프로젝트에서 이미 검수 실행이 시작됐으면(acquireReviewRun) 실행 상태를 덮지 않음
    if (get().isReviewing && get().initializedProjectId === project.id) return;
    set({
      chunks,
      currentChunkIndex: 0,
      results: [],
      isReviewing: false,
      progress: { completed: 0, total: chunks.length },
      initializedProjectId: project.id,
      highlightEnabled: false,  // 초기화 시 기존 하이라이트 무효화
      resolvedIssueIds: [],
      reviewActionHistory: [],
      highlightNonce: get().highlightNonce + 1,  // 에디터에 변경 알림
    });
  },

  acquireReviewRun: (projectId: string) => {
    if (get().isReviewing) return false;
    set({
      isReviewing: true,
      initializedProjectId: projectId,
      progress: { completed: 0, total: 0 },
      streamingText: '',
    });
    return true;
  },

  releaseReviewRun: () => {
    set({ isReviewing: false });
  },

  addResult: (result: ReviewResult) => {
    const { results, progress, highlightNonce } = get();
    set({
      results: [...results, result],
      currentChunkIndex: result.chunkIndex + 1,
      progress: { ...progress, completed: progress.completed + 1 },
      highlightEnabled: true, // 결과가 추가되면 하이라이트 자동 활성화
      highlightNonce: highlightNonce + 1,
    });
  },

  ingestExternalReview: ({ projectId, issues }) => {
    const { highlightNonce } = get();
    const normalized: ReviewIssue[] = issues.map((it, i) => {
      const segmentOrder = it.segmentOrder ?? i;
      const sourceExcerpt = stripRichTextMarkup(it.sourceExcerpt);
      const targetExcerpt = stripRichTextMarkup(it.targetExcerpt);
      return {
        id: generateIssueId(segmentOrder, it.type, sourceExcerpt, targetExcerpt),
        segmentOrder,
        segmentGroupId: it.segmentGroupId,
        sourceExcerpt,
        targetExcerpt,
        suggestedFix: stripRichTextMarkup(it.suggestedFix ?? ''),
        type: it.type,
        severity: it.severity,
        description: stripRichTextMarkup(it.description),
        checked: true,
      };
    });
    set({
      results: [{ chunkIndex: 0, issues: normalized }],
      currentChunkIndex: 1,
      progress: { completed: 1, total: 1 },
      isReviewing: false,
      totalIssuesFound: normalized.length,
      initializedProjectId: projectId,
      severityFilter: ['critical', 'major', 'minor'],
      highlightEnabled: true,
      resolvedIssueIds: [],
      reviewActionHistory: [],
      highlightNonce: highlightNonce + 1,
      streamingText: '',
    });
  },

  handleChunkError: (chunkIndex: number, error: Error) => {
    const { results, progress, highlightNonce } = get();
    set({
      results: [
        ...results,
        {
          chunkIndex,
          issues: [],
          error: error.message,
        },
      ],
      currentChunkIndex: chunkIndex + 1,
      progress: { ...progress, completed: progress.completed + 1 },
      highlightNonce: highlightNonce + 1,
    });
  },

  startReview: (chunksOverride?: AlignedChunk[]) => {
    const { highlightNonce } = get();
    const nextChunks = chunksOverride ?? get().chunks;
    set({
      isReviewing: true,
      results: [],
      currentChunkIndex: 0,
      chunks: nextChunks,
      progress: { completed: 0, total: nextChunks.length },
      resolvedIssueIds: [],
      reviewActionHistory: [],
      highlightNonce: highlightNonce + 1, // 즉시 이전 하이라이트 제거
      totalIssuesFound: 0, // 새 검수 시작 시 리셋
      streamingText: '', // 스트리밍 텍스트 초기화
    });
  },

  finishReview: () => {
    // 해결/무시된 항목도 이번 검수에서 발견된 전체 건수에는 포함한다.
    const totalIssues = new Set(
      get().results.flatMap((result) => result.issues.map((issue) => issue.id)),
    ).size;
    set({
      isReviewing: false,
      totalIssuesFound: totalIssues,
      // Note: streamingText는 초기화하지 않음 - 검수 완료 후에도 마지막 응답 확인 가능
    });
  },

  resetReview: () => {
    const { highlightNonce } = get();
    clearReviewChunkCache(); // 메모리 해제 + 다음 리뷰에서 최신 문서 사용 보장
    set({
      ...initialState,
      highlightNonce: highlightNonce + 1, // 에디터에 refresh 신호 전송
    });
  },

  requestReviewRun: (instruction?: string) => {
    // 이미 검수 중이면 무시
    if (get().isReviewing) return;
    set({ pendingReviewRun: { instruction: instruction?.trim() ?? '' } });
  },

  consumePendingReviewRun: () => {
    const { pendingReviewRun } = get();
    if (!pendingReviewRun) return null;
    set({ pendingReviewRun: null });
    return pendingReviewRun;
  },

  getChunk: (chunkIndex: number) => {
    const { chunks } = get();
    if (chunkIndex >= chunks.length) return null;
    return chunks[chunkIndex] ?? null;
  },

  getAllIssues: () => {
    const { results, highlightNonce, resolvedIssueIds } = get();

    // 캐시 히트: nonce가 변경되지 않았으면 캐시된 값 반환
    if (cachedNonce === highlightNonce) {
      return cachedAllIssues;
    }

    // 캐시 미스: 전체 이슈 재계산
    const resolved = new Set(resolvedIssueIds);
    const allIssues = results.flatMap((r) => r.issues).filter((issue) => !resolved.has(issue.id));

    // 중복 제거: id 기반 (결정적 ID)
    const seen = new Map<string, ReviewIssue>();
    for (const issue of allIssues) {
      if (!seen.has(issue.id)) {
        seen.set(issue.id, issue);
      }
    }

    // 캐시 업데이트
    cachedAllIssues = Array.from(seen.values());
    cachedNonce = highlightNonce;

    return cachedAllIssues;
  },

  toggleIssueCheck: (issueId: string) => {
    const { results, highlightNonce } = get();
    const updatedResults = results.map((result) => ({
      ...result,
      issues: result.issues.map((issue) =>
        issue.id === issueId ? { ...issue, checked: !issue.checked } : issue,
      ),
    }));
    set({ results: updatedResults, highlightNonce: highlightNonce + 1 });
  },

  ignoreIssue: ({ issueId, projectId }) => {
    const { results, initializedProjectId, resolvedIssueIds, reviewActionHistory, highlightNonce } = get();
    if (
      initializedProjectId !== projectId
      || resolvedIssueIds.includes(issueId)
      || !results.some((result) => result.issues.some((issue) => issue.id === issueId))
    ) {
      return null;
    }

    const entry: IgnoredIssueHistoryEntry = {
      actionId: createReviewActionId('ignored'),
      kind: 'ignored',
      issueId,
      projectId,
      state: 'resolved',
    };
    const nextHistory = trimReviewActionHistory([
      ...reviewActionHistory.filter((item) => !(item.kind === 'ignored' && item.issueId === issueId)),
      entry,
    ]);
    set({
      reviewActionHistory: nextHistory,
      resolvedIssueIds: resolvedIssueIds.includes(issueId)
        ? resolvedIssueIds
        : [...resolvedIssueIds, issueId],
      highlightNonce: highlightNonce + 1,
    });
    return entry.actionId;
  },

  undoIgnoredIssue: (actionId) => {
    const { results, initializedProjectId, resolvedIssueIds, reviewActionHistory, highlightNonce } = get();
    const actionIndex = reviewActionHistory.findIndex((entry) =>
      entry.actionId === actionId
      && entry.kind === 'ignored'
      && entry.state === 'resolved'
      && entry.projectId === initializedProjectId,
    );
    if (actionIndex < 0) return false;

    const action = reviewActionHistory[actionIndex]!;
    if (!results.some((result) => result.issues.some((issue) => issue.id === action.issueId))) {
      return false;
    }

    const nextHistory = reviewActionHistory.map((entry, index) =>
      index === actionIndex ? { ...entry, state: 'undone' as const } : entry,
    );
    set({
      reviewActionHistory: nextHistory,
      resolvedIssueIds: reconcileResolvedIssueId(resolvedIssueIds, nextHistory, action.issueId),
      highlightNonce: highlightNonce + 1,
    });
    return true;
  },

  recordAppliedSuggestion: (entry) => {
    const { results, resolvedIssueIds, reviewActionHistory, highlightNonce } = get();
    if (!results.some((result) => result.issues.some((issue) => issue.id === entry.issueId))) {
      return null;
    }
    if (resolvedIssueIds.includes(entry.issueId)) return null;

    const appliedEntry: AppliedSuggestionHistoryEntry = {
      ...entry,
      actionId: createReviewActionId('applied'),
      kind: 'applied',
      state: 'resolved',
    };
    // 새 문서 변경은 ProseMirror redo 스택을 비우므로 undone 기록도 함께 폐기한다.
    const nextHistory = trimReviewActionHistory([
      ...reviewActionHistory.filter((item) => item.state === 'resolved'),
      appliedEntry,
    ]);
    set({
      resolvedIssueIds: [...resolvedIssueIds, entry.issueId],
      reviewActionHistory: nextHistory,
      highlightNonce: highlightNonce + 1,
    });
    return appliedEntry.actionId;
  },

  reconcileAppliedSuggestionTransaction: ({ projectId, beforeDoc, afterDoc }) => {
    const { reviewActionHistory, resolvedIssueIds, highlightNonce } = get();

    // 같은 transaction을 listener와 명시적 undo 경로가 연달아 확인해도 멱등적으로 처리한다.
    const alreadyUndone = reviewActionHistory.find((entry) =>
      entry.kind === 'applied'
      && entry.projectId === projectId
      && entry.state === 'undone'
      && beforeDoc.eq(entry.afterDoc)
      && afterDoc.eq(entry.beforeDoc),
    );
    if (alreadyUndone) return 'undone';

    let undoIndex = -1;
    for (let index = reviewActionHistory.length - 1; index >= 0; index -= 1) {
      const entry = reviewActionHistory[index]!;
      if (
        entry.kind === 'applied'
        && entry.projectId === projectId
        && entry.state === 'resolved'
        && beforeDoc.eq(entry.afterDoc)
        && afterDoc.eq(entry.beforeDoc)
      ) {
        undoIndex = index;
        break;
      }
    }
    if (undoIndex >= 0) {
      const action = reviewActionHistory[undoIndex]!;
      const nextHistory = reviewActionHistory.map((item, index) =>
        index === undoIndex ? { ...item, state: 'undone' as const } : item,
      );
      set({
        reviewActionHistory: nextHistory,
        resolvedIssueIds: reconcileResolvedIssueId(resolvedIssueIds, nextHistory, action.issueId),
        highlightNonce: highlightNonce + 1,
      });
      return 'undone';
    }

    const alreadyRedone = reviewActionHistory.find((entry) =>
      entry.kind === 'applied'
      && entry.projectId === projectId
      && entry.state === 'resolved'
      && beforeDoc.eq(entry.beforeDoc)
      && afterDoc.eq(entry.afterDoc),
    );
    if (alreadyRedone) return 'redone';

    const redoIndex = reviewActionHistory.findIndex((entry) =>
      entry.kind === 'applied'
      && entry.projectId === projectId
      && entry.state === 'undone'
      && beforeDoc.eq(entry.beforeDoc)
      && afterDoc.eq(entry.afterDoc),
    );
    if (redoIndex >= 0) {
      const action = reviewActionHistory[redoIndex]!;
      const nextHistory = reviewActionHistory.map((item, index) =>
        index === redoIndex ? { ...item, state: 'resolved' as const } : item,
      );
      set({
        reviewActionHistory: nextHistory,
        resolvedIssueIds: reconcileResolvedIssueId(resolvedIssueIds, nextHistory, action.issueId),
        highlightNonce: highlightNonce + 1,
      });
      return 'redone';
    }

    return null;
  },

  setAllIssuesChecked: (checked: boolean) => {
    const { results, highlightNonce } = get();
    const updatedResults = results.map((result) => ({
      ...result,
      issues: result.issues.map((issue) => ({ ...issue, checked })),
    }));
    set({ results: updatedResults, highlightNonce: highlightNonce + 1 });
  },

  getCheckedIssues: () => {
    const { severityFilter } = get();
    const allIssues = get().getAllIssues();
    return allIssues.filter((issue) => issue.checked && severityFilter.includes(issue.severity));
  },

  toggleHighlight: () => {
    const { highlightEnabled, highlightNonce } = get();
    set({
      highlightEnabled: !highlightEnabled,
      highlightNonce: highlightNonce + 1,
    });
  },

  disableHighlight: () => {
    const { highlightNonce } = get();
    set({
      highlightEnabled: false,
      highlightNonce: highlightNonce + 1,  // 에디터 새로고침 트리거
    });
  },

  refreshHighlight: () => {
    const { highlightNonce } = get();
    set({ highlightNonce: highlightNonce + 1 });
  },

  toggleSeverityFilter: (severity: IssueSeverity) => {
    const { severityFilter, highlightNonce } = get();
    const next = severityFilter.includes(severity)
      ? severityFilter.filter((s) => s !== severity)
      : [...severityFilter, severity];
    set({ severityFilter: next, highlightNonce: highlightNonce + 1 });
  },

  getFilteredIssues: () => {
    const { severityFilter } = get();
    const allIssues = get().getAllIssues();
    return allIssues.filter((issue) => severityFilter.includes(issue.severity));
  },

  setStreamingText: (text: string) => {
    set({ streamingText: text });
  },
}));

// ============================================
// 문서 변경 시 하이라이트 처리
// ============================================
// ReviewHighlight.ts의 ProseMirror plugin이 문서 변경을 처리
// - 편집 중에는 기존 데코레이션을 tr.mapping으로 위치만 이동 (키 입력당 O(n) 재계산 방지)
// - 전체 재계산은 300ms idle 디바운스 후 또는 highlightNonce 갱신(refreshEditorHighlight) 시 수행
// - 편집으로 텍스트가 변경되어 못 찾으면 재계산 시점에 자연스럽게 제거됨
// - 이전에는 cross-store subscription으로 전체 무효화했으나 제거됨
