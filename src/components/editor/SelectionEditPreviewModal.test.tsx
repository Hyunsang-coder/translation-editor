import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionEditPreviewModal } from './SelectionEditPreviewModal';
import { isSegmentChanged } from '@/utils/selectionEditDiff';
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

  it('셀 목록은 스크롤되고 추가 지시사항 이하는 고정 영역에 둔다', () => {
    const cells = [
      { sourceText: 'One', currentText: '하나', replacementText: '하나 다듬음' },
      { sourceText: 'Two', currentText: '둘', replacementText: '둘 다듬음' },
    ];
    renderModal({ mode: 'polish', cells });

    const scrollArea = screen.getByTestId('selection-edit-scroll-area');
    const fixedArea = screen.getByTestId('selection-edit-fixed-area');

    expect(scrollArea).toHaveClass('overflow-y-auto', 'flex-1', 'min-h-0');
    expect(screen.getAllByTestId('selection-edit-cell')[0]).toBeInTheDocument();
    expect(scrollArea).toContainElement(screen.getAllByTestId('selection-edit-cell')[0]!);
    expect(fixedArea).toContainElement(screen.getByTestId('selection-edit-instruction'));
    expect(fixedArea).toContainElement(screen.getByTestId('selection-edit-primary-button'));
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

  describe('재번역 ↔ 폴리싱 탭', () => {
    it('onModeChange가 있으면 탭을 보여주고, 다른 탭을 누르면 그 모드를 넘긴다', () => {
      const onModeChange = vi.fn();
      renderModal({ mode: 'retranslate', onModeChange });

      expect(screen.getByTestId('selection-edit-mode-retranslate')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      fireEvent.click(screen.getByTestId('selection-edit-mode-polish'));

      expect(onModeChange).toHaveBeenCalledWith('polish');
    });

    it('현재 탭을 다시 눌러도 모드 변경을 알리지 않는다 (제안이 헛되이 갈리지 않게)', () => {
      const onModeChange = vi.fn();
      renderModal({ mode: 'polish', onModeChange });

      fireEvent.click(screen.getByTestId('selection-edit-mode-polish'));

      expect(onModeChange).not.toHaveBeenCalled();
    });

    it('연결된 원문이 없으면 재번역 탭을 막는다', () => {
      const onModeChange = vi.fn();
      renderModal({ mode: 'polish', sourceText: '', onModeChange });

      expect(screen.getByTestId('selection-edit-mode-retranslate')).toBeDisabled();
      fireEvent.click(screen.getByTestId('selection-edit-mode-retranslate'));
      expect(onModeChange).not.toHaveBeenCalled();
    });

    it('생성 중에는 탭을 잠근다', () => {
      renderModal({ mode: 'retranslate', isLoading: true, onModeChange: vi.fn() });

      expect(screen.getByTestId('selection-edit-mode-polish')).toBeDisabled();
    });

    it('onModeChange가 없으면(채팅 제안 미리보기) 탭을 숨긴다', () => {
      renderModal({ replacementText: '개선된 번역', proposalOnly: true });

      expect(screen.queryByTestId('selection-edit-mode-polish')).toBeNull();
    });

    it('탭이 바뀌면 직접 수정 화면을 닫는다 — 편집 중이던 제안이 다른 것으로 갈리기 때문', () => {
      const { rerender, props } = renderModal({
        mode: 'retranslate',
        replacementText: '재번역 결과',
        onReplacementChange: vi.fn(),
        onModeChange: vi.fn(),
      });

      fireEvent.click(screen.getByTestId('selection-edit-proposal-toggle'));
      expect(screen.getByTestId('selection-edit-proposal-editor')).toBeInTheDocument();

      rerender(
        <SelectionEditPreviewModal {...props} mode="polish" replacementText="폴리싱 결과" />,
      );

      expect(screen.queryByTestId('selection-edit-proposal-editor')).toBeNull();
    });
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

    it('전체 선택 체크박스는 스크롤 영역 밖 고정 헤더(selection-edit-cells-header)에 위치한다', () => {
      renderModal({ mode: 'polish', cells });

      const header = screen.getByTestId('selection-edit-cells-header');
      const scrollArea = screen.getByTestId('selection-edit-scroll-area');
      const selectAll = screen.getByTestId('selection-edit-cell-select-all');

      expect(header).toContainElement(selectAll);
      expect(scrollArea).not.toContainElement(selectAll);
    });

    it('내용 변경이 없는 블록은 기본적으로 목록에서 숨겨지고 토글 버튼으로 볼 수 있다', () => {
      const mixedCells = [
        { sourceText: 'Player', currentText: 'Player', replacementText: 'Player' }, // 변경 없음
        { sourceText: 'Jump', currentText: '점프', replacementText: '점프 제거' }, // 변경됨
        { sourceText: 'Move', currentText: '이동', replacementText: '이동' }, // 변경 없음
      ];

      renderModal({ mode: 'polish', cells: mixedCells });

      // 기본적으로 변경된 1개 블록만 카드에 표시됨
      expect(screen.getAllByTestId('selection-edit-cell')).toHaveLength(1);
      expect(screen.getByTestId('selection-edit-cell')).toHaveTextContent('점프 제거');

      // 상단 헤더에 "변경 없음 2개" 및 토글 버튼 확인
      const toggleButton = screen.getByTestId('selection-edit-toggle-unchanged');
      expect(toggleButton).toHaveTextContent('변경 없는 블록 2개 보기');

      // 변경 없는 블록 보기 클릭 -> 3개 모두 표시됨
      fireEvent.click(toggleButton);
      expect(screen.getAllByTestId('selection-edit-cell')).toHaveLength(3);

      // 다시 토글 클릭 -> 숨겨짐
      fireEvent.click(toggleButton);
      expect(screen.getAllByTestId('selection-edit-cell')).toHaveLength(1);
    });

    it('모든 블록이 변경 없는 경우 안내 문구가 뜨고 적용 버튼이 비활성화된다', () => {
      const unchangedCells = [
        { sourceText: 'Player', currentText: 'Player', replacementText: 'Player' },
        { sourceText: 'Move', currentText: '이동', replacementText: '이동' },
      ];

      renderModal({ mode: 'polish', cells: unchangedCells });

      expect(screen.getByTestId('selection-edit-no-changes')).toBeInTheDocument();
      expect(screen.getByTestId('selection-edit-primary-button')).toBeDisabled();
    });
  });

  describe('isSegmentChanged', () => {
    it('제안 텍스트가 없으면 변경 없음으로 판정한다', () => {
      expect(isSegmentChanged('텍스트', undefined)).toBe(false);
      expect(isSegmentChanged('텍스트', '')).toBe(false);
    });

    it('앞뒤 공백만 다른 경우 변경 없음으로 판정한다', () => {
      expect(isSegmentChanged('텍스트', '  텍스트  ')).toBe(false);
      expect(isSegmentChanged('텍스트\n', '텍스트')).toBe(false);
    });

    it('내용이 실제로 달라졌을 때만 변경으로 판정한다', () => {
      expect(isSegmentChanged('기존 텍스트', '개선된 텍스트')).toBe(true);
      expect(isSegmentChanged('Player', 'Player')).toBe(false);
      expect(isSegmentChanged('Player', 'Player 1')).toBe(true);
    });
  });
});
