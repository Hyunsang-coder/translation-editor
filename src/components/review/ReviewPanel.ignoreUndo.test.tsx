import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';
import { useUIStore } from '@/stores/uiStore';
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
  buildReviewPrompt: vi.fn(() => ''),
}));
vi.mock('@/ai/translateDocument', () => ({
  translateWithStreaming: vi.fn(),
  formatTranslationError: (error: unknown) => String(error),
}));
vi.mock('@/components/glossary/ProjectGlossarySection', () => ({ ProjectGlossarySection: () => null }));
vi.mock('@/components/editor/TranslatePreviewModal', () => ({ TranslatePreviewModal: () => null }));
vi.mock('@/components/review/ReviewResultsTable', () => ({
  ReviewResultsTable: ({
    issues,
    onIgnore,
  }: {
    issues: ReviewIssue[];
    onIgnore: (issueId: string) => void;
  }) => (
    <>
      {issues.map((issue) => (
        <button key={issue.id} type="button" onClick={() => onIgnore(issue.id)}>
          ignore-{issue.id}
        </button>
      ))}
    </>
  ),
}));

const FIRST_ISSUE: ReviewIssue = {
  id: 'ignore-first',
  segmentOrder: 0,
  segmentGroupId: undefined,
  sourceExcerpt: '첫 번째 원문',
  targetExcerpt: 'first target',
  suggestedFix: 'first fix',
  type: 'mistranslation',
  severity: 'major',
  description: '첫 번째 설명',
  checked: true,
};

const SECOND_ISSUE: ReviewIssue = {
  ...FIRST_ISSUE,
  id: 'ignore-second',
  segmentOrder: 1,
  sourceExcerpt: '두 번째 원문',
  targetExcerpt: 'second target',
  suggestedFix: 'second fix',
  description: '두 번째 설명',
};

const addToastSpy = vi.fn();
const originalAddToast = useUIStore.getState().addToast;

function fakeProject(): ITEProject {
  return {
    id: 'project-ignore',
    version: '1.0',
    metadata: {
      title: 'Ignore project',
      domain: 'general',
      createdAt: 0,
      updatedAt: 0,
      settings: {},
    },
    segments: [],
    blocks: {},
  } as unknown as ITEProject;
}

describe('검수 항목 무시 되돌리기', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ targetEditor: null });
    useUIStore.setState({ addToast: addToastSpy });
    useProjectStore.setState({
      project: fakeProject(),
      sourceDocument: '<p>원문</p>',
      targetDocument: '<p>번역문</p>',
    });
    useReviewStore.getState().resetReview();
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [FIRST_ISSUE, SECOND_ISSUE] }],
      initializedProjectId: 'project-ignore',
      totalIssuesFound: 2,
      isReviewing: false,
      highlightEnabled: true,
      highlightNonce: 1,
    });
  });

  afterEach(() => {
    cleanup();
    useEditorStore.setState({ targetEditor: null });
    useUIStore.setState({ addToast: originalAddToast });
    useProjectStore.setState({ project: null, sourceDocument: '', targetDocument: '' });
    useReviewStore.getState().resetReview();
  });

  it('무시 알림의 되돌리기를 누르면 해당 검수 항목이 복원된다', () => {
    render(<ReviewPanel />);

    fireEvent.click(screen.getByText('ignore-ignore-first'));

    expect(useReviewStore.getState().getAllIssues()).toEqual([SECOND_ISSUE]);
    const ignoreToast = addToastSpy.mock.calls.find(([toast]) => toast.type === 'info')?.[0] as {
      message: string;
      action?: { label: string; onClick: () => void };
    } | undefined;
    expect(ignoreToast?.message).toBe('검수 항목을 무시했습니다.');
    expect(ignoreToast?.action?.label).toBe('되돌리기');

    act(() => {
      ignoreToast?.action?.onClick();
    });

    expect(useReviewStore.getState().getAllIssues()).toEqual([FIRST_ISSUE, SECOND_ISSUE]);
  });

  it('각 알림은 더 최근 항목이 아니라 자신이 무시한 항목을 복원한다', () => {
    render(<ReviewPanel />);

    fireEvent.click(screen.getByText('ignore-ignore-first'));
    fireEvent.click(screen.getByText('ignore-ignore-second'));

    const ignoreToasts = addToastSpy.mock.calls
      .map(([toast]) => toast)
      .filter((toast) => toast.type === 'info' && toast.action) as Array<{
        action: { onClick: () => void };
      }>;
    act(() => {
      ignoreToasts[0]?.action.onClick();
    });

    expect(useReviewStore.getState().getAllIssues()).toEqual([FIRST_ISSUE]);
  });

  it('토스트 액션과 별개로 최근 처리를 패널에서 되돌릴 수 있다', () => {
    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('ignore-ignore-first'));

    fireEvent.click(screen.getByTestId('review-undo-last-action'));

    expect(useReviewStore.getState().getAllIssues()).toEqual([FIRST_ISSUE, SECOND_ISSUE]);
  });
});
