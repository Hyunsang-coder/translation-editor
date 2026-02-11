import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, defaultValue?: unknown) =>
        typeof defaultValue === 'string' ? defaultValue : key,
    }),
  };
});

vi.mock('@/components/editor/TranslatePreviewModal', () => ({
  TranslatePreviewModal: () => null,
}));

vi.mock('@/ai/review/runReview', () => ({
  runReview: vi.fn(),
}));

vi.mock('@/ai/tools/reviewTool', () => ({
  buildAlignedChunksAsync: vi.fn(async () => []),
}));

vi.mock('@/ai/translateDocument', () => ({
  translateWithStreaming: vi.fn(),
  formatTranslationError: vi.fn((e: unknown) => String(e)),
}));

vi.mock('@/tauri/glossary', () => ({
  searchGlossary: vi.fn(async () => []),
}));

vi.mock('@/utils/markdownConverter', () => ({
  tipTapJsonToHtml: vi.fn(() => '<p></p>'),
}));

describe('ReviewPanel', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
    useProjectStore.setState({
      project: null,
      sourceDocument: '',
      targetDocument: '',
    });
  });

  it('초기 렌더 이후 결과가 추가되면 이슈 목록을 즉시 표시한다', async () => {
    const issue: ReviewIssue = {
      id: 'issue-1',
      segmentOrder: 1,
      segmentGroupId: 'seg-1',
      sourceExcerpt: 'source excerpt',
      targetExcerpt: 'target excerpt',
      suggestedFix: 'TEST_FIX_TEXT',
      type: 'mistranslation',
      severity: 'major',
      description: 'TEST_DESCRIPTION',
      checked: false,
    };

    render(<ReviewPanel />);

    expect(screen.queryByText('TEST_FIX_TEXT')).not.toBeInTheDocument();

    act(() => {
      useReviewStore.getState().addResult({
        chunkIndex: 0,
        issues: [issue],
      });
      useReviewStore.getState().finishReview();
    });

    await waitFor(() => {
      expect(screen.getByText('TEST_FIX_TEXT')).toBeInTheDocument();
    });
    expect(screen.queryByText('모든 이슈가 해결되었습니다.')).not.toBeInTheDocument();
  });
});
