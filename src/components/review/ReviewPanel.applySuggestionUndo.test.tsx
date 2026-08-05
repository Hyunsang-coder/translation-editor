import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
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
    onApply,
  }: {
    issues: ReviewIssue[];
    onApply: (issue: ReviewIssue) => void;
  }) => (
    <>
      {issues.map((issue) => (
        <button key={issue.id} type="button" onClick={() => onApply(issue)}>
          apply-{issue.id}
        </button>
      ))}
    </>
  ),
}));

const ISSUE: ReviewIssue = {
  id: 'issue-undo',
  segmentOrder: 0,
  segmentGroupId: undefined,
  sourceExcerpt: '원문',
  targetExcerpt: 'target text',
  suggestedFix: 'fixed text',
  type: 'mistranslation',
  severity: 'major',
  description: '오역입니다.',
  checked: true,
};

const SECOND_ISSUE: ReviewIssue = {
  ...ISSUE,
  id: 'issue-undo-second',
  sourceExcerpt: '두 번째 원문',
  targetExcerpt: 'second text',
  suggestedFix: 'second fixed',
};

const addToastSpy = vi.fn();
const originalAddToast = useUIStore.getState().addToast;
let editor: Editor;

function fakeProject(): ITEProject {
  return {
    id: 'project-undo',
    version: '1.0',
    metadata: {
      title: 'Undo project',
      domain: 'general',
      createdAt: 0,
      updatedAt: 0,
      settings: {},
    },
    segments: [],
    blocks: {},
  } as unknown as ITEProject;
}

describe('검수 한 문장 적용 되돌리기', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editor = new Editor({
      extensions: [StarterKit],
      content: '<p>target text</p>',
    });
    useEditorStore.setState({ targetEditor: editor });
    useUIStore.setState({ addToast: addToastSpy });
    useProjectStore.setState({
      project: fakeProject(),
      sourceDocument: '<p>원문</p>',
      targetDocument: '<p>target text</p>',
    });
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [ISSUE] }],
      initializedProjectId: 'project-undo',
      totalIssuesFound: 1,
      isReviewing: false,
      highlightEnabled: true,
      highlightNonce: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    editor.destroy();
    useEditorStore.setState({ targetEditor: null });
    useUIStore.setState({ addToast: originalAddToast });
    useProjectStore.setState({ project: null, sourceDocument: '', targetDocument: '' });
    useReviewStore.getState().resetReview();
  });

  it('적용 알림의 되돌리기를 누르면 문장과 검수 항목이 함께 복원된다', () => {
    render(<ReviewPanel />);

    fireEvent.click(screen.getByText('apply-issue-undo'));

    expect(editor.getText()).toBe('fixed text');
    expect(useReviewStore.getState().getAllIssues()).toHaveLength(0);

    const successToast = addToastSpy.mock.calls.find(([toast]) => toast.type === 'success')?.[0] as {
      action?: { label: string; onClick: () => void };
    } | undefined;
    expect(successToast?.action?.label).toBe('되돌리기');

    act(() => {
      successToast?.action?.onClick();
    });

    expect(editor.getText()).toBe('target text');
    expect(useReviewStore.getState().getAllIssues()).toEqual([ISSUE]);
  });

  it('적용 후 문서가 바뀌면 알림이 다른 편집을 잘못 되돌리지 않는다', () => {
    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-issue-undo'));

    const successToast = addToastSpy.mock.calls.find(([toast]) => toast.type === 'success')?.[0] as {
      action?: { onClick: () => void };
    } | undefined;
    editor.commands.insertContentAt(editor.state.doc.content.size, ' later edit');

    act(() => {
      successToast?.action?.onClick();
    });

    expect(editor.getText()).toContain('fixed text');
    expect(editor.getText()).toContain('later edit');
    expect(useReviewStore.getState().getAllIssues()).toHaveLength(0);
    expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });

  it('알림의 5초가 지나도 검수 패널에서 마지막 적용을 되돌릴 수 있다', () => {
    vi.useFakeTimers();
    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-issue-undo'));

    act(() => {
      vi.advanceTimersByTime(5001);
    });

    const persistentUndo = screen.getByTestId('review-undo-last-action');
    fireEvent.click(persistentUndo);

    expect(editor.getText()).toBe('target text');
    expect(useReviewStore.getState().getAllIssues()).toEqual([ISSUE]);
  });

  it('키보드 undo와 redo가 검수 항목의 해결 상태도 함께 전환한다', () => {
    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-issue-undo'));

    act(() => {
      expect(editor.commands.undo()).toBe(true);
    });
    expect(editor.getText()).toBe('target text');
    expect(useReviewStore.getState().getAllIssues()).toEqual([ISSUE]);

    act(() => {
      expect(editor.commands.redo()).toBe(true);
    });
    expect(editor.getText()).toBe('fixed text');
    expect(useReviewStore.getState().getAllIssues()).toHaveLength(0);
  });

  it('undo 후 같은 이슈를 다시 적용해도 적용 이력을 중복으로 쌓지 않는다', () => {
    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-issue-undo'));

    act(() => {
      editor.commands.undo();
    });
    fireEvent.click(screen.getByText('apply-issue-undo'));

    const issueHistory = useReviewStore.getState().reviewActionHistory
      .filter((entry) => entry.kind === 'applied' && entry.issueId === ISSUE.id);
    expect(issueHistory).toHaveLength(1);
    expect(issueHistory[0]?.state).toBe('resolved');
  });

  it('이전 적용 알림은 더 최근 적용을 대신 되돌리지 않는다', () => {
    editor.destroy();
    editor = new Editor({
      extensions: [StarterKit],
      content: '<p>target text second text</p>',
    });
    useEditorStore.setState({ targetEditor: editor });
    useProjectStore.setState({ targetDocument: '<p>target text second text</p>' });
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [ISSUE, SECOND_ISSUE] }],
      resolvedIssueIds: [],
      reviewActionHistory: [],
      highlightNonce: 2,
    });

    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-issue-undo'));
    fireEvent.click(screen.getByText('apply-issue-undo-second'));

    const successToasts = addToastSpy.mock.calls
      .map(([toast]) => toast)
      .filter((toast) => toast.type === 'success') as Array<{
        action?: { onClick: () => void };
      }>;

    act(() => {
      successToasts[0]?.action?.onClick();
    });

    expect(editor.getText()).toBe('fixed text second fixed');
    expect(useReviewStore.getState().getAllIssues()).toHaveLength(0);
    expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });
});
