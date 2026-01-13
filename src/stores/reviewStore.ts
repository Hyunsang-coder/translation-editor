import { create } from 'zustand';
import type { ITEProject } from '@/types';
import { buildAlignedChunks, type AlignedChunk } from '@/ai/tools/reviewTool';

// ============================================
// Review Settings Types
// ============================================

/** 검수 강도 */
export type ReviewIntensity = 'minimal' | 'balanced' | 'thorough';

/** 검수 항목 */
export interface ReviewCategories {
  mistranslation: boolean;  // 오역
  omission: boolean;        // 누락
  distortion: boolean;      // 왜곡 (강도/범위 변경)
  consistency: boolean;     // 용어 일관성
}

/** 검수 설정 기본값 */
const defaultCategories: ReviewCategories = {
  mistranslation: true,
  omission: true,
  distortion: false,  // 기본 off (과잉 검출 방지)
  consistency: true,
};

// ============================================
// Review Result Types
// ============================================

export type IssueType = 'error' | 'omission' | 'distortion' | 'consistency';

/**
 * 결정적 ID 생성 (중복 제거 + 체크 상태 유지용)
 * 간단한 해시 구현 - 브라우저에서 동작
 */
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
  description: string;
  checked: boolean;              // 체크 상태
}

export interface ReviewResult {
  chunkIndex: number;
  issues: ReviewIssue[];
  error?: string;
}

// ============================================
// Review Store State
// ============================================

interface ReviewState {
  // 검수 설정 (persist됨)
  intensity: ReviewIntensity;
  categories: ReviewCategories;
  settingsExpanded: boolean;  // 아코디언 상태

  // 검수 실행 상태
  chunks: AlignedChunk[];
  currentChunkIndex: number;
  results: ReviewResult[];
  isReviewing: boolean;
  progress: { completed: number; total: number };
  highlightEnabled: boolean;  // 하이라이트 활성화 여부
  highlightNonce: number;     // 하이라이트 업데이트 트리거 (nonce 증가 시 재계산)
  initializedProjectId: string | null;  // 초기화된 프로젝트 ID (탭 전환 시 상태 유지)
}

interface ReviewActions {
  /**
   * 검수 초기화: 프로젝트를 청크로 분할하고 상태 초기화
   */
  initializeReview: (project: ITEProject) => void;

  /**
   * 검수 결과 추가
   */
  addResult: (result: ReviewResult) => void;

  /**
   * 청크 에러 처리
   */
  handleChunkError: (chunkIndex: number, error: Error) => void;

  /**
   * 검수 시작 상태로 전환
   */
  startReview: () => void;

  /**
   * 검수 완료 상태로 전환
   */
  finishReview: () => void;

  /**
   * 검수 상태 초기화
   */
  resetReview: () => void;

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

  /**
   * 이슈 삭제
   */
  deleteIssue: (issueId: string) => void;

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
   * 검수 강도 설정
   */
  setIntensity: (intensity: ReviewIntensity) => void;

  /**
   * 검수 항목 토글
   */
  toggleCategory: (category: keyof ReviewCategories) => void;

  /**
   * 설정 섹션 펼침/접기
   */
  setSettingsExpanded: (expanded: boolean) => void;
}

type ReviewStore = ReviewState & ReviewActions;

// ============================================
// Store Implementation
// ============================================

const initialState: ReviewState = {
  // 검수 설정 기본값
  intensity: 'balanced',
  categories: { ...defaultCategories },
  settingsExpanded: false,

  // 검수 실행 상태 기본값
  chunks: [],
  currentChunkIndex: 0,
  results: [],
  isReviewing: false,
  progress: { completed: 0, total: 0 },
  highlightEnabled: false,
  highlightNonce: 0,
  initializedProjectId: null,
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
  ...initialState,

  initializeReview: (project: ITEProject) => {
    const { initializedProjectId } = get();
    // 이미 같은 프로젝트로 초기화되어 있으면 스킵 (탭 전환 시 상태 유지)
    if (initializedProjectId === project.id) {
      return;
    }
    const chunks = buildAlignedChunks(project);
    set({
      chunks,
      currentChunkIndex: 0,
      results: [],
      isReviewing: false,
      progress: { completed: 0, total: chunks.length },
      initializedProjectId: project.id,
    });
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

  handleChunkError: (chunkIndex: number, error: Error) => {
    const { results, progress } = get();
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
    });
  },

  startReview: () => {
    const { chunks } = get();
    set({
      isReviewing: true,
      results: [],
      currentChunkIndex: 0,
      progress: { completed: 0, total: chunks.length },
    });
  },

  finishReview: () => {
    set({ isReviewing: false });
  },

  resetReview: () => {
    set(initialState);
  },

  getChunk: (chunkIndex: number) => {
    const { chunks } = get();
    if (chunkIndex >= chunks.length) return null;
    return chunks[chunkIndex] ?? null;
  },

  getAllIssues: () => {
    const { results } = get();
    const allIssues = results.flatMap((r) => r.issues);

    // 중복 제거: id 기반 (결정적 ID)
    const seen = new Map<string, ReviewIssue>();
    for (const issue of allIssues) {
      if (!seen.has(issue.id)) {
        seen.set(issue.id, issue);
      }
    }

    return Array.from(seen.values());
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

  deleteIssue: (issueId: string) => {
    const { results, highlightNonce } = get();
    const updatedResults = results.map((result) => ({
      ...result,
      issues: result.issues.filter((issue) => issue.id !== issueId),
    }));
    set({ results: updatedResults, highlightNonce: highlightNonce + 1 });
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
    const allIssues = get().getAllIssues();
    return allIssues.filter((issue) => issue.checked);
  },

  toggleHighlight: () => {
    const { highlightEnabled, highlightNonce } = get();
    set({
      highlightEnabled: !highlightEnabled,
      highlightNonce: highlightNonce + 1,
    });
  },

  disableHighlight: () => {
    set({ highlightEnabled: false });
  },

  refreshHighlight: () => {
    const { highlightNonce } = get();
    set({ highlightNonce: highlightNonce + 1 });
  },

  setIntensity: (intensity: ReviewIntensity) => {
    set({ intensity });
  },

  toggleCategory: (category: keyof ReviewCategories) => {
    const { categories } = get();
    set({
      categories: {
        ...categories,
        [category]: !categories[category],
      },
    });
  },

  setSettingsExpanded: (expanded: boolean) => {
    set({ settingsExpanded: expanded });
  },
}));
