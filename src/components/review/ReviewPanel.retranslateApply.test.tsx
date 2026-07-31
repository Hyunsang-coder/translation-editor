import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
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
  buildReviewPrompt: vi.fn(() => ''),
}));
vi.mock('@/ai/translateDocument', () => ({
  translateWithStreaming: vi.fn(),
  formatTranslationError: (e: unknown) => String(e),
}));
vi.mock('@/components/review/ReviewResultsTable', () => ({ ReviewResultsTable: () => null }));
vi.mock('@/components/glossary/ProjectGlossarySection', () => ({ ProjectGlossarySection: () => null }));
vi.mock('@/editor/utils/replaceDocContent', () => ({ replaceDocContent: vi.fn() }));

const RETRANSLATED_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '재번역 결과' }] }],
};

// 재번역 프리뷰 모달은 onApplySelective(doc)로 적용 경로를 그대로 노출한다.
// 실제 모달 UI를 거치지 않고 그 콜백만 눌러 적용 경로를 검증한다.
vi.mock('@/components/editor/TranslatePreviewModal', () => ({
  TranslatePreviewModal: ({
    onApplySelective,
  }: {
    onApplySelective?: (doc: unknown) => void;
  }) => (
    <button type="button" onClick={() => onApplySelective?.(RETRANSLATED_DOC)}>
      apply-retranslation
    </button>
  ),
}));

const mockReplaceDocContent = vi.mocked(replaceDocContent);
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
  return { isDestroyed } as unknown as ReturnType<typeof useEditorStore.getState>['targetEditor'];
}

describe('재번역 적용은 에디터 undo 스택을 거친다', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewStore.getState().resetReview();
    useUIStore.setState({ addToast: addToastSpy });
    useProjectStore.setState({
      project: fakeProject('proj-retranslate'),
      sourceDocument: '<p>source text</p>',
      targetDocument: '<p>target text</p>',
    });
  });

  afterEach(() => {
    cleanup();
    useReviewStore.getState().resetReview();
    useEditorStore.setState({ targetEditor: null });
    useProjectStore.setState({ project: null, sourceDocument: '', targetDocument: '' });
  });

  it('addToHistory: true로 에디터에 직접 적용한다 (store 우회 금지 — Ctrl+Z 가능)', () => {
    const editor = fakeTargetEditor();
    useEditorStore.setState({ targetEditor: editor });

    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).toHaveBeenCalledTimes(1);
    expect(mockReplaceDocContent).toHaveBeenCalledWith(editor, RETRANSLATED_DOC, {
      addToHistory: true,
    });
  });

  it('target 에디터가 없으면 적용하지 않고 검수 결과를 보존한다', () => {
    useEditorStore.setState({ targetEditor: null });
    useReviewStore.setState({ streamingText: '검수 진행 흔적' });

    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).not.toHaveBeenCalled();
    expect(useReviewStore.getState().streamingText).toBe('검수 진행 흔적');
    expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('파괴된 에디터에는 적용하지 않는다', () => {
    useEditorStore.setState({ targetEditor: fakeTargetEditor(true) });

    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(mockReplaceDocContent).not.toHaveBeenCalled();
  });

  it('적용이 실패하면 검수 결과를 지우지 않는다', () => {
    useEditorStore.setState({ targetEditor: fakeTargetEditor() });
    useReviewStore.setState({ streamingText: '검수 진행 흔적' });
    mockReplaceDocContent.mockImplementationOnce(() => {
      throw new Error('unknown node type');
    });

    render(<ReviewPanel />);
    fireEvent.click(screen.getByText('apply-retranslation'));

    expect(useReviewStore.getState().streamingText).toBe('검수 진행 흔적');
    expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});
