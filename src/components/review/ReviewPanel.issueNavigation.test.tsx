/**
 * 검수 패널이 이슈 위치 이동을 어느 화면에서든 같은 콜백으로 연결하는지,
 * 정렬 화면에서 남긴 카드 이동 요청이 패널 마운트 뒤에 소비되는지 확인한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { ReviewPanel } from './ReviewPanel';
import type { ITEProject } from '@/types';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'ko' },
    }),
  };
});

vi.mock('@/ai/review/runReview', () => ({ runReview: vi.fn() }));
vi.mock('@/tauri/glossary', () => ({ searchGlossary: vi.fn(async () => []) }));
vi.mock('@/ai/tools/reviewTool', () => ({
  buildAlignedChunksAsync: vi.fn(async () => []),
  clearReviewChunkCache: vi.fn(),
  buildAlignedChunks: vi.fn(() => []),
  buildScopedAlignedChunks: vi.fn(() => []),
  buildReviewPrompt: vi.fn(() => ''),
}));
vi.mock('@/ai/translateDocument', () => ({
  translateWithStreaming: vi.fn(),
  formatTranslationError: (e: unknown) => String(e),
}));
vi.mock('@/components/editor/TranslatePreviewModal', () => ({
  TranslatePreviewModal: () => null,
}));

const navigateToReviewIssue = vi.fn();
vi.mock('@/components/review/navigateToReviewIssue', () => ({
  navigateToReviewIssue: (...args: unknown[]) => navigateToReviewIssue(...args),
}));

/** ReviewResultsTable에 실제로 전달된 props를 가로챈다 */
interface CapturedProps {
  onNavigate?: (issueId: string) => void;
  pendingScrollIssue?: { issueId: string; requestId: number } | null;
  onPendingScrollHandled?: (requestId: number) => void;
}
const captured: CapturedProps[] = [];
vi.mock('@/components/review/ReviewResultsTable', () => ({
  ReviewResultsTable: (props: CapturedProps) => {
    captured.push(props);
    return null;
  },
}));

const ISSUE: ReviewIssue = {
  id: 'issue-1',
  segmentOrder: 0,
  segmentGroupId: undefined,
  sourceExcerpt: 'source text',
  targetExcerpt: 'target text',
  suggestedFix: 'fixed text',
  type: 'mistranslation',
  severity: 'major',
  description: '오역입니다',
  checked: false,
};

function fakeProject(id: string): ITEProject {
  return {
    id,
    version: '1.0',
    metadata: { title: `Project ${id}`, domain: 'general', createdAt: 0, updatedAt: 0, settings: {} },
    segments: [],
    blocks: {},
  } as unknown as ITEProject;
}

function latest(): CapturedProps {
  return captured[captured.length - 1]!;
}

describe('ReviewPanel 이슈 위치 이동 연결', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.length = 0;
    useReviewStore.getState().resetReview();
    useProjectStore.setState({
      project: fakeProject('proj-a'),
      sourceDocument: '<p>source text</p>',
      targetDocument: '<p>target text</p>',
    });
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [ISSUE] }],
      isReviewing: false,
      highlightNonce: useReviewStore.getState().highlightNonce + 1,
    });
    useUIStore.setState({ pendingReviewIssueNavigation: null });
  });

  afterEach(() => {
    cleanup();
    useReviewStore.getState().resetReview();
    useProjectStore.setState({ project: null, sourceDocument: '', targetDocument: '' });
  });

  it('검수 완료 화면에서 카드 클릭이 이슈 위치 이동을 부른다', () => {
    render(<ReviewPanel />);

    latest().onNavigate?.(ISSUE.id);

    expect(navigateToReviewIssue).toHaveBeenCalledWith(ISSUE.id, 'review-card');
  });

  it('검수 진행 중 화면에도 같은 콜백이 전달된다', () => {
    useReviewStore.setState({ isReviewing: true });

    render(<ReviewPanel />);

    latest().onNavigate?.(ISSUE.id);

    expect(navigateToReviewIssue).toHaveBeenCalledWith(ISSUE.id, 'review-card');
  });

  it('마운트 전에 남긴 카드 이동 요청이 목록에 전달되고, 처리하면 소비된다', () => {
    // 정렬 화면에서 검수 패널을 여는 상황: 요청이 먼저, 마운트가 나중이다
    useUIStore.getState().requestReviewIssueNavigation(ISSUE.id);
    const request = useUIStore.getState().pendingReviewIssueNavigation!;

    render(<ReviewPanel />);

    expect(latest().pendingScrollIssue).toEqual(request);

    act(() => latest().onPendingScrollHandled?.(request.requestId));
    expect(useUIStore.getState().pendingReviewIssueNavigation).toBeNull();
  });

  it('이미 지나간 요청 ID로는 새 요청을 지우지 않는다', () => {
    useUIStore.getState().requestReviewIssueNavigation(ISSUE.id);
    const stale = useUIStore.getState().pendingReviewIssueNavigation!.requestId;

    render(<ReviewPanel />);

    act(() => useUIStore.getState().requestReviewIssueNavigation('issue-2'));
    act(() => useUIStore.getState().consumeReviewIssueNavigation(stale));

    expect(useUIStore.getState().pendingReviewIssueNavigation)
      .toMatchObject({ issueId: 'issue-2' });
  });
});
