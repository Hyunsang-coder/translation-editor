import { create } from 'zustand';
import type { ITEProject } from '@/types';
import { buildAlignedChunks, type AlignedChunk } from '@/ai/tools/reviewTool';

// ============================================
// Review Settings Types
// ============================================

/** 검수 강도 (대조 검수 + 폴리싱) */
export type ReviewIntensity =
  | 'minimal' | 'balanced' | 'thorough'  // 대조 검수: 원문 ↔ 번역문
  | 'grammar' | 'fluency';                // 폴리싱: 번역문만

/**
 * 폴리싱 모드인지 판별
 * 폴리싱 모드는 원문 없이 번역문만 검사
 */
export function isPolishingMode(intensity: ReviewIntensity): boolean {
  return intensity === 'grammar' || intensity === 'fluency';
}

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
  totalIssuesFound: number;  // 검수 완료 시점의 총 이슈 수 (UI 메시지 분기용)
  streamingText: string;  // 현재 청크의 AI 스트리밍 응답 텍스트
  reviewTrigger: number;  // 외부에서 검수 시작 요청 트리거 (nonce 증가 시 ReviewPanel에서 검수 시작)
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
   * 외부에서 검수 시작 요청 (ReviewPanel이 감지하여 실행)
   */
  triggerReview: () => void;

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
  totalIssuesFound: 0,
  streamingText: '',
  reviewTrigger: 0,
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

  triggerReview: () => {
    const { isReviewing, reviewTrigger } = get();
    // 이미 검수 중이면 무시
    if (isReviewing) return;
    set({ reviewTrigger: reviewTrigger + 1 });
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

  setIntensity: (intensity: ReviewIntensity) => {
    set({ intensity });
  },

  setStreamingText: (text: string) => {
    set({ streamingText: text });
  },
}));

// ============================================
// 문서 변경 시 하이라이트 처리
// ============================================
// ReviewHighlight.ts의 ProseMirror plugin이 tr.docChanged 감지 시 자동으로 재계산
// - 찾을 수 있는 이슈는 계속 하이라이트 유지
// - 편집으로 텍스트가 변경되어 못 찾으면 자연스럽게 제거됨
// - 이전에는 cross-store subscription으로 전체 무효화했으나 제거됨
