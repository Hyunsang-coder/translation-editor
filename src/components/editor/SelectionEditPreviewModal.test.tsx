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
  it('전역 제약(번역 규칙·금칙어)은 켜고, 질의 의존 컨텍스트는 끈 채로 시작한다', () => {
    renderModal();
    expect(screen.getByTestId('selection-reference-translationRules')).toBeChecked();
    expect(screen.getByTestId('selection-reference-forbiddenTerms')).toBeChecked();
    expect(screen.getByTestId('selection-reference-glossary')).not.toBeChecked();
    expect(screen.getByTestId('selection-reference-projectContext')).not.toBeChecked();
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
});
