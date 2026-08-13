import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionEditPreviewModal } from './SelectionEditPreviewModal';
import {
  DEFAULT_SELECTION_REFERENCE_OPTIONS,
  type SelectionContext,
} from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

const selection: SelectionContext = {
  selectionId: 'selection-1',
  selectionScopeId: 'scope-1',
  projectId: 'project-1',
  panel: 'target',
  text: '기존 번역',
  from: 1,
  to: 6,
  anchorId: 'anchor-1',
  translationUnitIds: ['unit-1'],
  documentRevision: 'revision-1',
  status: 'active',
  spansMultipleBlocks: false,
  createdAt: 1,
};

function renderModal(overrides: Partial<Parameters<typeof SelectionEditPreviewModal>[0]> = {}) {
  const props: Parameters<typeof SelectionEditPreviewModal>[0] = {
    open: true,
    selection,
    sourceText: 'Source text',
    replacementText: '',
    instruction: '',
    referenceOptions: { ...DEFAULT_SELECTION_REFERENCE_OPTIONS },
    contextManifest: undefined,
    isLoading: false,
    error: null,
    onInstructionChange: vi.fn(),
    onReferenceOptionsChange: vi.fn(),
    onGenerate: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<SelectionEditPreviewModal {...props} />);
  return { props, ...view };
}

describe('SelectionEditPreviewModal', () => {
  it('문서 전체에 걸린 확정 사항(규칙·금칙어·용어집)은 켜고, 프로젝트 메모리는 끈 채로 시작한다', () => {
    renderModal();
    expect(screen.getByTestId('selection-reference-translationRules')).toBeChecked();
    expect(screen.getByTestId('selection-reference-forbiddenTerms')).toBeChecked();
    expect(screen.getByTestId('selection-reference-glossary')).toBeChecked();
    expect(screen.getByTestId('selection-reference-projectMemory')).not.toBeChecked();
  });

  it('수정안이 없으면 재번역을 실행하고, 수정안이 있으면 적용한다', () => {
    const first = renderModal();
    fireEvent.click(screen.getByRole('button', { name: '재번역' }));
    expect(first.props.onGenerate).toHaveBeenCalledTimes(1);

    first.unmount();
    const second = renderModal({ replacementText: '개선된 번역' });
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(second.props.onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveTextContent('개선된 번역');
  });

  it('대응 원문의 정렬 정밀도를 표시한다', () => {
    renderModal({ sourceAlignmentPrecision: 'sentence' });

    expect(screen.getByTestId('selection-source-alignment-precision')).toHaveTextContent(
      '문장 단위 대응',
    );
  });

  it('수정안이 있으면 "다시 재번역"으로 재생성할 수 있다', () => {
    const { props } = renderModal({ replacementText: '개선된 번역' });

    fireEvent.click(screen.getByTestId('selection-edit-regenerate-button'));

    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('생성 중에는 다시 재번역 버튼을 숨긴다', () => {
    renderModal({ replacementText: '스트리밍 중', isLoading: true });

    expect(screen.queryByTestId('selection-edit-regenerate-button')).toBeNull();
  });

  it('직접 수정 토글로 수정안을 편집하면 onReplacementChange로 전달된다', () => {
    const onReplacementChange = vi.fn();
    renderModal({ replacementText: '개선된 번역', onReplacementChange });

    fireEvent.click(screen.getByTestId('selection-edit-proposal-toggle'));
    const editorField = screen.getByTestId('selection-edit-proposal-editor');
    fireEvent.change(editorField, { target: { value: '손으로 고친 번역' } });

    expect(onReplacementChange).toHaveBeenCalledWith('손으로 고친 번역');
  });

  it('onReplacementChange가 없으면(채팅 제안 미리보기) 편집 토글을 숨긴다', () => {
    renderModal({ replacementText: '개선된 번역', proposalOnly: true });

    expect(screen.queryByTestId('selection-edit-proposal-toggle')).toBeNull();
    expect(screen.queryByTestId('selection-edit-regenerate-button')).toBeNull();
  });
});
