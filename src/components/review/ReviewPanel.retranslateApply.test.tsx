import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { translateWithStreaming } from '@/ai/translateDocument';
import { message } from '@tauri-apps/plugin-dialog';
import { ReviewPanel } from './ReviewPanel';
import type { ITEProject } from '@/types';
import type { ReviewIssue } from '@/stores/reviewStore';

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
  formatTranslationError: (e: unknown) => String(e),
}));
vi.mock('@/components/review/ReviewResultsTable', () => ({ ReviewResultsTable: () => null }));
vi.mock('@/components/glossary/ProjectGlossarySection', () => ({ ProjectGlossarySection: () => null }));
vi.mock('@/editor/utils/replaceDocContent', () => ({ replaceDocContent: vi.fn() }));
// 적용 취소 안내는 토스트가 아니라 네이티브 팝업(plugin-dialog message)으로 나간다.
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn(async () => undefined) }));

const RETRANSLATED_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '재번역 결과' }] }],
};

const TARGET_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '기존 번역' }] }],
};

const REVIEW_ISSUE: ReviewIssue = {
  id: 'issue-1',
  segmentOrder: 0,
  segmentGroupId: 'segment-1',
  sourceExcerpt: 'source text',
  targetExcerpt: 'target text',
  suggestedFix: 'fixed target',
  type: 'mistranslation',
  severity: 'major',
  description: 'wrong translation',
  checked: true,
};

// 재번역 프리뷰 모달은 onApplySelective(doc)로 적용 경로를 그대로 노출한다.
// 실제 모달 UI를 거치지 않고 그 콜백만 눌러 적용 경로를 검증한다.
let capturedApplySelective: ((doc: typeof RETRANSLATED_DOC) => void) | undefined;

vi.mock('@/components/editor/TranslatePreviewModal', () => ({
  TranslatePreviewModal: ({
    open,
    docJson,
    onApplySelective,
  }: {
    open: boolean;
    docJson?: unknown;
    onApplySelective?: (doc: unknown) => void;
  }) => {
    if (!open) return null;
    capturedApplySelective = onApplySelective as typeof capturedApplySelective;
    return (
      <button
        type="button"
        disabled={!docJson}
        onClick={() => onApplySelective?.(RETRANSLATED_DOC)}
      >
        apply-retranslation
      </button>
    );
  },
}));

const mockReplaceDocContent = vi.mocked(replaceDocContent);
const mockTranslateWithStreaming = vi.mocked(translateWithStreaming);
const mockMessageDialog = vi.mocked(message);
// 토스트는 store 배열이 아니라 sonner로 나가므로, 액션 자체를 스파이로 대체해 관찰한다.
const addToastSpy = vi.fn();

function fakeProject(id: string): ITEProject {
  return {
    id,
    version: '1.0',
    metadata: { title: `Project ${id}`, domain: 'general', createdAt: 0, updatedAt: 0, settings: {} },
    segments: [],
    blocks: {},
  } as unknown as ITEProject;
}

function fakeTargetEditor(isDestroyed = false) {
  let doc = TARGET_DOC;
  return {
    isDestroyed,
    getJSON: () => doc,
    setDoc: (next: typeof TARGET_DOC) => {
      doc = next;
    },
  } as unknown as NonNullable<ReturnType<typeof useEditorStore.getState>['targetEditor']> & {
    setDoc: (next: typeof TARGET_DOC) => void;
  };
}

function seedCheckedIssue(projectId = 'proj-retranslate'): void {
  useReviewStore.setState({
    results: [{ chunkIndex: 0, issues: [REVIEW_ISSUE] }],
    initializedProjectId: projectId,
    severityFilter: ['critical', 'major', 'minor'],
  });
}

async function finishRetranslationRequest(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '재번역' }));
  fireEvent.click(screen.getByRole('button', { name: '재번역 실행' }));
  await waitFor(() => {
    expect(mockTranslateWithStreaming).toHaveBeenCalledTimes(1);
    expect(screen.getByText('apply-retranslation')).not.toBeDisabled();
  });
}

describe('재번역 적용은 에디터 undo 스택을 거친다', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedApplySelective = undefined;
    useReviewStore.getState().resetReview();
    useUIStore.setState({ addToast: addToastSpy });
    useProjectStore.setState({
      project: fakeProject('proj-retranslate'),
      sourceDocument: '<p>source text</p>',
      targetDocument: '<p>target text</p>',
      sourceDocJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'source text' }] }],
      },
      materializeBlocksForSnapshot: () => null,
    });
    seedCheckedIssue();
    mockTranslateWithStreaming.mockResolvedValue({
      doc: RETRANSLATED_DOC,
      raw: 'translated',
    });
  });

  afterEach(() => {
    cleanup();
    useReviewStore.getState().resetReview();
    useEditorStore.setState({ targetEditor: null });
    useProjectStore.setState({ project: null, sourceDocument: '', targetDocument: '' });
  });

  it('addToHistory: true로 에디터에 직접 적용한다 (store 우회 금지 — Ctrl+Z 가능)', async () => {
    const editor = fakeTargetEditor();
    useEditorStore.setState({ targetEditor: editor });

    render(<ReviewPanel />);
    await finishRetranslationRequest();
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).toHaveBeenCalledTimes(1);
    expect(mockReplaceDocContent).toHaveBeenCalledWith(editor, RETRANSLATED_DOC, {
      addToHistory: true,
    });
  });

  it('target 에디터가 없으면 적용하지 않고 검수 결과를 보존한다', async () => {
    useEditorStore.setState({ targetEditor: null });
    useReviewStore.setState({ streamingText: '검수 진행 흔적' });

    render(<ReviewPanel />);
    await finishRetranslationRequest();
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).not.toHaveBeenCalled();
    expect(useReviewStore.getState().streamingText).toBe('검수 진행 흔적');
    expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('파괴된 에디터에는 적용하지 않는다', async () => {
    useEditorStore.setState({ targetEditor: fakeTargetEditor(true) });

    render(<ReviewPanel />);
    await finishRetranslationRequest();
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).not.toHaveBeenCalled();
  });

  it('적용이 실패하면 검수 결과를 지우지 않는다', async () => {
    useEditorStore.setState({ targetEditor: fakeTargetEditor() });
    useReviewStore.setState({ streamingText: '검수 진행 흔적' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockReplaceDocContent.mockImplementationOnce(() => {
      throw new Error('unknown node type');
    });

    render(<ReviewPanel />);
    await finishRetranslationRequest();
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(useReviewStore.getState().streamingText).toBe('검수 진행 흔적');
    expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    warnSpy.mockRestore();
  });

  it('프리뷰 생성 후 프로젝트가 바뀌면 stale 결과를 적용하지 않는다', async () => {
    useEditorStore.setState({ targetEditor: fakeTargetEditor() });
    render(<ReviewPanel />);
    await finishRetranslationRequest();
    const staleApply = capturedApplySelective;
    expect(staleApply).toBeTypeOf('function');

    await act(async () => {
      useProjectStore.setState({ project: fakeProject('project-b') });
      await Promise.resolve();
    });
    await act(async () => {
      staleApply?.(RETRANSLATED_DOC);
    });

    expect(mockReplaceDocContent).not.toHaveBeenCalled();
    expect(mockMessageDialog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'warning' }),
    );
  });

  it('프리뷰 생성 후 Target 문서가 바뀌면 stale 결과를 적용하지 않는다', async () => {
    const editor = fakeTargetEditor();
    useEditorStore.setState({ targetEditor: editor });
    render(<ReviewPanel />);
    await finishRetranslationRequest();

    editor.setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '사용자가 수정함' }] }],
    });
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).not.toHaveBeenCalled();
    expect(mockMessageDialog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 'warning' }),
    );
  });

  it('재번역 중 패널이 언마운트되면 AI 요청을 취소한다', async () => {
    useEditorStore.setState({ targetEditor: fakeTargetEditor() });
    let requestSignal: AbortSignal | undefined;
    mockTranslateWithStreaming.mockImplementation(async (params) => {
      requestSignal = params.abortSignal;
      await new Promise<void>(() => undefined);
      return { doc: RETRANSLATED_DOC, raw: 'never' };
    });

    const view = render(<ReviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: '재번역' }));
    fireEvent.click(screen.getByRole('button', { name: '재번역 실행' }));
    await waitFor(() => expect(requestSignal).toBeDefined());

    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
