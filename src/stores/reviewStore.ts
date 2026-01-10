import { create } from 'zustand';
import type { ITEProject } from '@/types';
import { buildAlignedChunks, type AlignedChunk } from '@/ai/tools/reviewTool';

// ============================================
// Review Result Types
// ============================================

export type IssueType = 'error' | 'omission' | 'distortion' | 'consistency';

export interface ReviewIssue {
  segmentOrder: number;
  sourceExcerpt: string;
  type: IssueType;
  description: string;
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
  chunks: AlignedChunk[];
  currentChunkIndex: number;
  results: ReviewResult[];
  isReviewing: boolean;
  progress: { completed: number; total: number };
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
}

type ReviewStore = ReviewState & ReviewActions;

// ============================================
// Store Implementation
// ============================================

const initialState: ReviewState = {
  chunks: [],
  currentChunkIndex: 0,
  results: [],
  isReviewing: false,
  progress: { completed: 0, total: 0 },
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
  ...initialState,

  initializeReview: (project: ITEProject) => {
    const chunks = buildAlignedChunks(project);
    set({
      chunks,
      currentChunkIndex: 0,
      results: [],
      isReviewing: false,
      progress: { completed: 0, total: chunks.length },
    });
  },

  addResult: (result: ReviewResult) => {
    const { results, progress } = get();
    set({
      results: [...results, result],
      currentChunkIndex: result.chunkIndex + 1,
      progress: { ...progress, completed: progress.completed + 1 },
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

    // 중복 제거: segmentOrder + sourceExcerpt 앞 20자 기준
    const seen = new Map<string, ReviewIssue>();
    for (const issue of allIssues) {
      const key = `${issue.segmentOrder}-${issue.sourceExcerpt.slice(0, 20)}`;
      if (!seen.has(key)) {
        seen.set(key, issue);
      }
    }

    return Array.from(seen.values());
  },
}));
