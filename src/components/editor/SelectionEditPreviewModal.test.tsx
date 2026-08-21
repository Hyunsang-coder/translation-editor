import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionEditPreviewModal } from './SelectionEditPreviewModal';
import {
  DEFAULT_SELECTION_REFERENCE_OPTIONS,
  type SelectionContext,
} from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // defaultValue + 보간까지 흉내 낸다 — 개수 표시가 실제로 무엇을 렌더하는지 봐야 한다.
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (!fallback) return key;
      const template = fallback['defaultValue'];
      if (typeof template !== 'string') return key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(fallback[name] ?? ''),
      );
    },
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

  describe('여러 블록 부분 적용', () => {
    const cells = [
      { sourceText: 'One', currentText: '하나', replacementText: '하나 다듬음' },
      { sourceText: 'Two', currentText: '둘', replacementText: '둘 다듬음' },
      { sourceText: 'Three', currentText: '셋', replacementText: '셋 다듬음' },
    ];

    it('제안이 도착하면 전부 선택된 상태로 시작하고, 적용은 고른 인덱스를 넘긴다', () => {
      const { props } = renderModal({ mode: 'polish', cells });

      const boxes = screen.getAllByTestId('selection-edit-cell-checkbox');
      expect(boxes).toHaveLength(3);
      boxes.forEach((box) => expect(box).toBeChecked());

      fireEvent.click(screen.getByRole('button', { name: '적용' }));
      expect(props.onApply).toHaveBeenCalledWith(new Set([0, 1, 2]));
    });

    it('일부를 해제하면 그 블록만 빼고 적용한다', () => {
      const { props } = renderModal({ mode: 'polish', cells });

      fireEvent.click(screen.getAllByTestId('selection-edit-cell-checkbox')[1]!);

      expect(screen.getByTestId('selection-edit-primary-button')).toHaveTextContent('2개 적용');
      fireEvent.click(screen.getByTestId('selection-edit-primary-button'));
      expect(props.onApply).toHaveBeenCalledWith(new Set([0, 2]));
    });

    it('전부 해제하면 적용 버튼을 막는다 (빈 트랜잭션 방지)', () => {
      renderModal({ mode: 'polish', cells });

      fireEvent.click(screen.getByTestId('selection-edit-cell-select-all'));

      screen
        .getAllByTestId('selection-edit-cell-checkbox')
        .forEach((box) => expect(box).not.toBeChecked());
      expect(screen.getByTestId('selection-edit-primary-button')).toBeDisabled();
    });

    it('스트리밍이 끊겨 일부만 도착하면 안 온 블록은 고를 수 없고 적용에서도 빠진다', () => {
      // 생성 중 에러: loading은 풀리지만 cells에는 부분 결과가 남는다.
      const { props } = renderModal({
        mode: 'polish',
        error: '부분 폴리싱 응답 형식이 올바르지 않습니다',
        cells: [cells[0]!, { ...cells[1]!, replacementText: '' }, { ...cells[2]!, replacementText: '' }],
      });

      // 제안이 온 블록에만 체크박스가 있다
      expect(screen.getAllByTestId('selection-edit-cell-checkbox')).toHaveLength(1);

      fireEvent.click(screen.getByTestId('selection-edit-primary-button'));
      // 빈 제안이 섞여 들어가면 그 블록이 지워진다 — 0번만 넘어가야 한다
      expect(props.onApply).toHaveBeenCalledWith(new Set([0]));
    });

    it('생성 중에는 블록 선택을 열지 않고 진행률을 보여준다', () => {
      renderModal({
        mode: 'polish',
        isLoading: true,
        cells: [cells[0]!, { ...cells[1]!, replacementText: '' }, { ...cells[2]!, replacementText: '' }],
      });

      expect(screen.queryByTestId('selection-edit-cell-checkbox')).toBeNull();
      expect(screen.getByTestId('selection-edit-progress')).toHaveTextContent('1/3');
    });
  });
});
