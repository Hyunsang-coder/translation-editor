import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useReviewStore } from '@/stores/reviewStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { runReview } from '@/ai/review/runReview';
import { buildAlignedChunksAsync, type AlignedChunk } from '@/ai/tools/reviewTool';
import { recordIssuesProposed } from '@/quality';
import { ReviewPanel } from './ReviewPanel';
import { SettingsContent } from '@/components/panels/SettingsContent';
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

vi.mock('@/ai/review/runReview', () => ({
  runReview: vi.fn(),
}));

vi.mock('@/tauri/glossary', () => ({
  searchGlossary: vi.fn(async () => []),
}));

vi.mock('@/ai/tools/reviewTool', () => ({
  buildAlignedChunksAsync: vi.fn(async () => []),
  clearReviewChunkCache: vi.fn(),
  buildAlignedChunks: vi.fn(() => []),
  buildReviewPrompt: vi.fn(() => ''),
}));

vi.mock('@/ai/translateDocument', () => ({
  translateWithStreaming: vi.fn(),
  formatTranslationError: (e: unknown) => String(e),
}));

vi.mock('@/quality', () => ({
  appReviewContext: vi.fn(() => ({
    origin: 'app',
    caughtBy: 'app_review',
    contentType: null,
    direction: null,
  })),
  ledgerIdForIssue: vi.fn(() => 'ledger-id'),
  recordIssuesProposed: vi.fn(async () => {}),
  recordIssueAccepted: vi.fn(async () => {}),
  recordIssuesRejected: vi.fn(async () => {}),
  saveQualityJsonl: vi.fn(async () => 'empty'),
  updateQualityDisposition: vi.fn(async () => {}),
}));

vi.mock('@/components/editor/TranslatePreviewModal', () => ({
  TranslatePreviewModal: () => null,
}));

vi.mock('@/components/review/ReviewResultsTable', () => ({
  ReviewResultsTable: () => null,
}));

vi.mock('@/components/glossary/ProjectGlossarySection', () => ({
  ProjectGlossarySection: () => null,
}));

describe('ReviewPanel - Zustand Selectors', () => {
  beforeEach(() => {
    // 각 테스트 전 store 초기화
    useReviewStore.setState({
      severityFilter: ['critical', 'major'],
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
    });
  });

  describe('streamingText 필드 selector', () => {
    it('streamingText만 구독하면 다른 필드 변경 시 리렌더 안된다', () => {
      const renderCount = { current: 0 };
      const streamingTextSelector = (s: ReturnType<typeof useReviewStore.getState>) => s.streamingText;

      const { result } = renderHook(
        () => {
          renderCount.current++;
          return useReviewStore(streamingTextSelector);
        }
      );

      const initialRenderCount = renderCount.current;

      act(() => {
        useReviewStore.setState({ severityFilter: ['critical'] });
      });

      expect(renderCount.current).toBe(initialRenderCount);
      expect(result.current).toBe('');
    });

    it('streamingText 변경 시 리렌더된다', () => {
      const renderCount = { current: 0 };

      const { result } = renderHook(
        () => {
          renderCount.current++;
          return useReviewStore((s) => s.streamingText);
        }
      );

      const initialRenderCount = renderCount.current;

      act(() => {
        useReviewStore.setState({ streamingText: 'new text' });
      });

      expect(renderCount.current).toBeGreaterThan(initialRenderCount);
      expect(result.current).toBe('new text');
    });
  });

  describe('액션 함수 selector', () => {
    it('액션 함수는 매번 같은 참조를 유지한다', () => {
      const functionSelector = (s: ReturnType<typeof useReviewStore.getState>) => s.startReview;

      const { result: result1 } = renderHook(() =>
        useReviewStore(functionSelector)
      );
      const { result: result2 } = renderHook(() =>
        useReviewStore(functionSelector)
      );

      expect(result1.current).toBe(result2.current);
    });
  });
});

// ============================================
// L4: 검수 실행 이중 실행 가드 + 전환 시 중단
// ============================================

const mockRunReview = vi.mocked(runReview);
const mockBuildChunks = vi.mocked(buildAlignedChunksAsync);
const mockRecordIssuesProposed = vi.mocked(recordIssuesProposed);

function fakeProject(id: string): ITEProject {
  return {
    id,
    version: '1.0',
    metadata: {
      title: `Project ${id}`,
      domain: 'general',
      createdAt: 0,
      updatedAt: 0,
      settings: {},
    },
    segments: [],
    blocks: {},
  } as unknown as ITEProject;
}

function buildChunk(index: number, groupId: string): AlignedChunk {
  return {
    chunkIndex: index,
    totalChars: 10,
    segments: [
      {
        groupId,
        order: index + 1,
        sourceText: 'source text',
        targetText: 'target text',
      },
    ],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// parseReviewResult(실제 구현)가 이슈 1건으로 파싱하는 최소 응답
const AI_RESPONSE_WITH_ISSUE = `
---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: "source text"
- **Target**: "target text"
- **Type**: Mistranslation
- **Severity**: 4
- **SegmentGroupId**: seg-1
- **Explanation**: 오역입니다
- **Suggestion**: "fixed text"

## Summary
- Verdict: MINOR REVISIONS
---REVIEW_END---
`;

describe('ReviewPanel 검수 실행 가드 (L4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewStore.getState().resetReview();
    useChatStore.setState({
      translationRules: 'Keep product names unchanged.',
      projectContext: 'Enterprise release notes for administrators.',
    });
    useProjectStore.setState({
      project: fakeProject('proj-a'),
      sourceDocument: '<p>source text</p>',
      targetDocument: '<p>target text</p>',
    });
  });

  afterEach(() => {
    cleanup();
    useReviewStore.getState().resetReview();
    useProjectStore.setState({ project: null, sourceDocument: '', targetDocument: '' });
    useChatStore.setState({ translationRules: '', projectContext: '' });
  });

  it('검수 시작 즉시(청크 빌드 완료 전) isReviewing이 true가 되어 이중 실행 창이 없다', async () => {
    // 마운트 초기화 + 실행 경로 모두 pending 상태로 유지
    let resolveBuild: ((chunks: AlignedChunk[]) => void) | null = null;
    mockBuildChunks.mockImplementation(
      () => new Promise<AlignedChunk[]>((res) => {
        resolveBuild = res;
      }),
    );
    mockRunReview.mockResolvedValue('---REVIEW_START---\nNO_ISSUES\n---REVIEW_END---');

    render(<ReviewPanel />);

    fireEvent.click(screen.getByTestId('review-run-button'));

    // 청크 빌드(await)가 끝나기 전에도 즉시 검수 중 상태 → 실행 버튼 제거 + 재획득 차단
    expect(useReviewStore.getState().isReviewing).toBe(true);
    expect(screen.queryByTestId('review-run-button')).toBeNull();
    expect(useReviewStore.getState().acquireReviewRun('proj-a')).toBe(false);

    // 청크 빌드 완료 → 루프 1회 실행 후 정상 종료
    await act(async () => {
      resolveBuild?.([buildChunk(0, 'seg-1')]);
    });
    await waitFor(() => {
      expect(useReviewStore.getState().isReviewing).toBe(false);
    });
    expect(mockRunReview).toHaveBeenCalledTimes(1);
  });

  it('정상 완료 시 품질 장부는 검수를 시작한 프로젝트 ID로 기록된다', async () => {
    mockBuildChunks.mockResolvedValue([buildChunk(0, 'seg-1')]);
    mockRunReview.mockResolvedValue(AI_RESPONSE_WITH_ISSUE);

    render(<ReviewPanel />);
    fireEvent.click(screen.getByTestId('review-run-button'));

    await waitFor(() => {
      expect(useReviewStore.getState().isReviewing).toBe(false);
    });

    expect(mockRecordIssuesProposed).toHaveBeenCalledTimes(1);
    expect(mockRecordIssuesProposed.mock.calls[0]![0]).toBe('proj-a');
    expect(useReviewStore.getState().getAllIssues()).toHaveLength(1);
  });

  it('검수 결과를 받은 후에도 프로젝트 컨텍스트를 유지하고 검수 프롬프트에 전달한다', async () => {
    mockBuildChunks.mockResolvedValue([buildChunk(0, 'seg-1')]);
    mockRunReview.mockResolvedValue(AI_RESPONSE_WITH_ISSUE);

    render(<ReviewPanel />);
    fireEvent.click(screen.getByTestId('review-run-button'));

    await waitFor(() => {
      expect(useReviewStore.getState().isReviewing).toBe(false);
    });

    expect(mockRunReview).toHaveBeenCalledWith(expect.objectContaining({
      translationRules: 'Keep product names unchanged.',
      projectContext: 'Enterprise release notes for administrators.',
    }));
    expect(useChatStore.getState().projectContext)
      .toBe('Enterprise release notes for administrators.');
  });

  it('컨텍스트 입력 직후 검수 탭으로 전환해 결과를 받아도 입력값을 유지한다', async () => {
    const typedContext = 'Context typed immediately before review.';
    const settings = render(<SettingsContent />);

    fireEvent.change(screen.getByTestId('settings-project-context'), {
      target: { value: typedContext },
    });
    // 실제 탭 전환처럼 500ms debounce 전에 SettingsContent를 언마운트한다.
    settings.unmount();

    expect(useChatStore.getState().projectContext).toBe(typedContext);

    mockBuildChunks.mockResolvedValue([buildChunk(0, 'seg-1')]);
    mockRunReview.mockResolvedValue(AI_RESPONSE_WITH_ISSUE);
    const review = render(<ReviewPanel />);
    fireEvent.click(screen.getByTestId('review-run-button'));

    await waitFor(() => {
      expect(useReviewStore.getState().isReviewing).toBe(false);
    });
    review.unmount();

    render(<SettingsContent />);
    expect(screen.getByTestId('settings-project-context')).toHaveValue(typedContext);
  });

  it('검수 중 프로젝트 전환 시 결과 주입과 장부 기록을 모두 중단한다 (장부 오염 방지)', async () => {
    mockBuildChunks.mockResolvedValue([buildChunk(0, 'seg-1')]);
    const reviewResponse = deferred<string>();
    mockRunReview.mockReturnValue(reviewResponse.promise);

    render(<ReviewPanel />);
    fireEvent.click(screen.getByTestId('review-run-button'));

    await waitFor(() => {
      expect(mockRunReview).toHaveBeenCalledTimes(1);
    });

    // 검수 응답 대기 중 프로젝트 전환 (B)
    act(() => {
      useProjectStore.setState({
        project: fakeProject('proj-b'),
        sourceDocument: '<p>b source</p>',
        targetDocument: '<p>b target</p>',
      });
    });

    // 전환 후에야 구 프로젝트 검수 응답 도착 (이슈 1건 포함)
    await act(async () => {
      reviewResponse.resolve(AI_RESPONSE_WITH_ISSUE);
    });

    await waitFor(() => {
      expect(useReviewStore.getState().isReviewing).toBe(false);
    });

    // 구 프로젝트 이슈가 새 프로젝트 상태/장부에 주입되지 않아야 함
    expect(mockRecordIssuesProposed).not.toHaveBeenCalled();
    expect(useReviewStore.getState().getAllIssues()).toHaveLength(0);
  });
});
