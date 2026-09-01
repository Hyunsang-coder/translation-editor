import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { ReviewIssue } from '@/stores/reviewStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import type { ReviewIssueNavigation } from '@/editor/utils/reviewIssueNavigation';

const scrollEditorToAnchor = vi.fn<(...args: unknown[]) => boolean>(() => true);
const resolveReviewIssueNavigation = vi.fn<(...args: unknown[]) => ReviewIssueNavigation>();

vi.mock('@/editor/utils/reviewIssueNavigation', () => ({
  resolveReviewIssueNavigation: (...args: unknown[]) => resolveReviewIssueNavigation(...args),
  scrollEditorToAnchor: (...args: unknown[]) => scrollEditorToAnchor(...args),
}));

const { navigateToReviewIssue } = await import('@/components/review/navigateToReviewIssue');

const ISSUE: ReviewIssue = {
  id: 'issue-1',
  segmentOrder: 0,
  segmentGroupId: undefined,
  sourceExcerpt: '반동이 감소했습니다.',
  targetExcerpt: 'The recoil was reduced.',
  suggestedFix: 'Recoil has been reduced.',
  type: 'mistranslation',
  severity: 'major',
  description: '설명',
  checked: false,
};

function navigation(overrides: Partial<ReviewIssueNavigation> = {}): ReviewIssueNavigation {
  return {
    issueId: ISSUE.id,
    source: { side: 'source', kind: 'exact-range', range: { from: 1, to: 5 } },
    target: { side: 'target', kind: 'exact-range', range: { from: 10, to: 20 } },
    primarySide: 'target',
    ...overrides,
  };
}

function fakeEditor(): Editor {
  return {
    isDestroyed: false,
    state: { doc: { type: 'doc' } },
    commands: { setTextSelection: vi.fn(), focus: vi.fn() },
  } as unknown as Editor;
}

let addToast: ReturnType<typeof vi.fn>;
let frames: Array<() => void>;

beforeEach(() => {
  vi.clearAllMocks();
  scrollEditorToAnchor.mockReturnValue(true);
  resolveReviewIssueNavigation.mockReturnValue(navigation());

  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });

  useReviewStore.setState({
    results: [{ chunkIndex: 0, issues: [ISSUE] }],
    resolvedIssueIds: [],
    reviewActionHistory: [],
    highlightNonce: useReviewStore.getState().highlightNonce + 1,
  });

  useEditorStore.setState({ sourceEditor: fakeEditor(), targetEditor: fakeEditor() });

  addToast = vi.fn();
  useUIStore.setState({
    focusMode: false,
    sourceOnlyMode: false,
    editorViewMode: 'document',
    editorZoom: 1,
    pendingReviewIssueNavigation: null,
    leftSidebar: {
      hidden: false,
      panels: ['settings', 'review', 'comments'],
      activePanel: 'settings',
      width: 250,
    },
    addToast,
  });
});

describe('navigateToReviewIssue', () => {
  it('두 패널을 각각 자기 앵커로 이동시킨다', () => {
    navigateToReviewIssue(ISSUE.id, 'review-card');

    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(2);
    const sides = scrollEditorToAnchor.mock.calls.map(
      (call) => (call[1] as { side: string }).side,
    );
    expect(sides).toEqual(['source', 'target']);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('기준 패널만 선택·포커스하고, 포커스가 스크롤을 덮어쓰지 않게 한다', () => {
    const target = useEditorStore.getState().targetEditor!;
    const source = useEditorStore.getState().sourceEditor!;

    navigateToReviewIssue(ISSUE.id, 'review-card');

    expect(target.commands.setTextSelection).toHaveBeenCalledWith({ from: 10, to: 20 });
    expect(target.commands.focus).toHaveBeenCalledWith(undefined, { scrollIntoView: false });
    expect(source.commands.setTextSelection).not.toHaveBeenCalled();
  });

  it('이미 해결·무시된 이슈는 아무것도 하지 않는다', () => {
    useReviewStore.setState({
      resolvedIssueIds: [ISSUE.id],
      highlightNonce: useReviewStore.getState().highlightNonce + 1,
    });

    navigateToReviewIssue(ISSUE.id, 'alignment-row');

    expect(scrollEditorToAnchor).not.toHaveBeenCalled();
    expect(useUIStore.getState().pendingReviewIssueNavigation).toBeNull();
  });

  it('정렬 행에서 부르면 검수 패널을 열고, 카드 이동 요청을 남긴다', () => {
    navigateToReviewIssue(ISSUE.id, 'alignment-row');

    expect(useUIStore.getState().leftSidebar.activePanel).toBe('review');
    expect(useUIStore.getState().pendingReviewIssueNavigation)
      .toMatchObject({ issueId: ISSUE.id });
  });

  it('카드에서 부르면 현재 패널 구성을 바꾸지 않는다', () => {
    navigateToReviewIssue(ISSUE.id, 'review-card');

    expect(useUIStore.getState().leftSidebar.activePanel).toBe('settings');
  });

  it('같은 이슈를 연속으로 눌러도 매번 새 requestId를 발급한다', () => {
    navigateToReviewIssue(ISSUE.id, 'review-card');
    const first = useUIStore.getState().pendingReviewIssueNavigation!.requestId;
    navigateToReviewIssue(ISSUE.id, 'review-card');
    const second = useUIStore.getState().pendingReviewIssueNavigation!.requestId;

    expect(second).not.toBe(first);
  });

  it('정렬 화면이면 문서 보기로 전환한 뒤 한 프레임 기다렸다 좌표를 잰다', () => {
    useUIStore.setState({ editorViewMode: 'alignment' });

    navigateToReviewIssue(ISSUE.id, 'alignment-row');

    expect(useUIStore.getState().editorViewMode).toBe('document');
    expect(scrollEditorToAnchor).not.toHaveBeenCalled();

    frames.forEach((frame) => frame());
    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(2);
  });

  it('숨겨진 패널은 이동하지도, 다시 열지도 않는다', () => {
    useUIStore.setState({ focusMode: true });

    navigateToReviewIssue(ISSUE.id, 'review-card');

    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(1);
    expect((scrollEditorToAnchor.mock.calls[0]![1] as { side: string }).side).toBe('target');
    expect(useUIStore.getState().focusMode).toBe(true);
  });

  it('양쪽 모두 위치를 못 찾으면 현재 위치를 유지하고 알린다', () => {
    scrollEditorToAnchor.mockReturnValue(false);

    navigateToReviewIssue(ISSUE.id, 'review-card');

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' }),
    );
  });

  it('한쪽만 성공하면 경고하지 않는다 — 추측하지 않은 결과다', () => {
    scrollEditorToAnchor.mockImplementation(
      (...args: unknown[]) => (args[1] as { side: string }).side === 'target',
    );

    navigateToReviewIssue(ISSUE.id, 'review-card');

    expect(addToast).not.toHaveBeenCalled();
  });
});
