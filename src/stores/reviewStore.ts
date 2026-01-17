import { create } from 'zustand';
import type { ITEProject } from '@/types';
import { buildAlignedChunks, type AlignedChunk } from '@/ai/tools/reviewTool';
import { useProjectStore } from '@/stores/projectStore';

// ============================================
// Review Settings Types
// ============================================

/** 검수 강도 */
export type ReviewIntensity = 'minimal' | 'balanced' | 'thorough';

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

  // 검수 실행 상태
  chunks: AlignedChunk[];
  currentChunkIndex: number;
  results: ReviewResult[];
  isReviewing: boolean;
  progress: { completed: number; total: number };
  highlightEnabled: boolean;  // 하이라이트 활성화 여부
  highlightNonce: number;     // 하이라이트 업데이트 트리거 (nonce 증가 시 재계산)
  initializedProjectId: string | null;  // 초기화된 프로젝트 ID (탭 전환 시 상태 유지)
  isApplyingSuggestion: boolean;  // 수정 제안 적용 중 (하이라이트 무효화 방지)
  totalIssuesFound: number;  // 검수 완료 시점의 총 이슈 수 (UI 메시지 분기용)
  streamingText: string;  // 현재 청크의 AI 스트리밍 응답 텍스트
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
   * 수정 제안 적용 중 플래그 설정 (하이라이트 무효화 방지용)
   */
  setIsApplyingSuggestion: (value: boolean) => void;

  /**
   * 스트리밍 텍스트 업데이트
   */
  setStreamingText: (text: string) => void;
}

type ReviewStore = ReviewState & ReviewActions;

// ============================================
// Store Implementation
// ============================================

const initialState: ReviewState = {
  // 검수 설정 기본값
  intensity: 'balanced',

  // 검수 실행 상태 기본값
  chunks: [],
  currentChunkIndex: 0,
  results: [],
  isReviewing: false,
  progress: { completed: 0, total: 0 },
  highlightEnabled: false,
  highlightNonce: 0,
  initializedProjectId: null,
  isApplyingSuggestion: false,
  totalIssuesFound: 0,
  streamingText: '',
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
  ...initialState,

  initializeReview: (project: ITEProject) => {
    const { initializedProjectId, results, highlightNonce } = get();
    // 이미 같은 프로젝트로 초기화되어 있고 검수 결과가 있으면 스킵 (탭 전환 시 상태 유지)
    // 검수 결과가 없으면 항상 재초기화 (resetReview 후 또는 첫 진입)
    if (initializedProjectId === project.id && results.length > 0) {
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
      highlightEnabled: false,  // 초기화 시 기존 하이라이트 무효화
      highlightNonce: highlightNonce + 1,  // 에디터에 변경 알림
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
    const { chunks, highlightNonce } = get();
    set({
      isReviewing: true,
      results: [],
      currentChunkIndex: 0,
      progress: { completed: 0, total: chunks.length },
      highlightNonce: highlightNonce + 1, // 즉시 이전 하이라이트 제거
      totalIssuesFound: 0, // 새 검수 시작 시 리셋
      streamingText: '', // 스트리밍 텍스트 초기화
    });
  },

  finishReview: () => {
    const allIssues = get().getAllIssues();
    set({
      isReviewing: false,
      totalIssuesFound: allIssues.length,
      // Note: streamingText는 초기화하지 않음 - 검수 완료 후에도 마지막 응답 확인 가능
    });
  },

  resetReview: () => {
    const { highlightNonce } = get();
    set({
      ...initialState,
      highlightNonce: highlightNonce + 1, // 에디터에 refresh 신호 전송
    });
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

  setIsApplyingSuggestion: (value: boolean) => {
    set({ isApplyingSuggestion: value });
  },

  setStreamingText: (text: string) => {
    set({ streamingText: text });
  },
}));

// ============================================
// Issue #6 Fix: 문서 변경 시 하이라이트 무효화
// ============================================
// projectStore의 targetDocJson 변경을 구독하여
// 검수 결과가 있고 하이라이트가 활성화된 상태에서 문서가 변경되면
// 하이라이트를 비활성화합니다 (오프셋 불일치 방지)

let prevTargetDocJson: unknown = null;

useProjectStore.subscribe((state) => {
  const { targetDocJson } = state;

  if (prevTargetDocJson !== null && targetDocJson !== prevTargetDocJson) {
    // 다음 tick에서 체크 (isApplyingSuggestion 상태 반영 보장)
    // Issue: setIsApplyingSuggestion(true) 호출 직후 replaceMatch()가 실행되면
    // subscription이 트리거될 때 상태가 아직 반영되지 않아 레이스 컨디션 발생
    setTimeout(() => {
      const reviewState = useReviewStore.getState();
      if (
        reviewState.highlightEnabled &&
        reviewState.results.length > 0 &&
        !reviewState.isApplyingSuggestion
      ) {
        console.log('[reviewStore] Target document changed while highlight active, disabling highlight');
        useReviewStore.getState().disableHighlight();
      }
    }, 0);
  }

  prevTargetDocJson = targetDocJson;
});
