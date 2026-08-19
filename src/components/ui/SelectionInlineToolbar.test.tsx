import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionInlineToolbar } from './SelectionInlineToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

/** AI 액션은 드롭다운 안에 있다 — 열어야 항목이 나온다. */
function openAiMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'editor.selectionAiActions' }));
}

describe('SelectionInlineToolbar', () => {
  it('선택 영역을 클립보드에 복사하는 액션을 표시하고 실행한다', () => {
    const onCopy = vi.fn();

    render(
      <SelectionInlineToolbar
        onCopy={onCopy}
        onAddToChat={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'editor.copySelection' }));

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('Source 선택에는 AI 액션을 표시하지 않는다', () => {
    render(
      <SelectionInlineToolbar
        panel="source"
        onCopy={vi.fn()}
        onAddToChat={vi.fn()}
        onRetranslateSelection={vi.fn()}
        onPolishSelection={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'editor.selectionAiActions' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'editor.retranslateSelection' })).toBeNull();
  });

  it('Target 선택에는 재번역 액션을 표시하고 실행한다', () => {
    const onRetranslateSelection = vi.fn();
    render(
      <SelectionInlineToolbar
        panel="target"
        onCopy={vi.fn()}
        onAddToChat={vi.fn()}
        onRetranslateSelection={onRetranslateSelection}
        onAddComment={vi.fn()}
      />,
    );

    openAiMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'editor.retranslateSelection' }));
    expect(onRetranslateSelection).toHaveBeenCalledTimes(1);
  });

  it('Target 선택에는 폴리싱 액션을 표시하고 실행한다', () => {
    const onPolishSelection = vi.fn();
    render(
      <SelectionInlineToolbar
        panel="target"
        onCopy={vi.fn()}
        onAddToChat={vi.fn()}
        onRetranslateSelection={vi.fn()}
        onPolishSelection={onPolishSelection}
        onReviewSelection={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    openAiMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'editor.polishSelection' }));

    expect(onPolishSelection).toHaveBeenCalledTimes(1);
    // 실행하면 메뉴는 닫힌다 — 열린 채로 두면 선택이 사라진 뒤에도 남는다.
    expect(screen.queryByRole('menuitem', { name: 'editor.polishSelection' })).toBeNull();
  });

  it('핸들러를 넘기지 않은 AI 액션은 메뉴에서 뺀다', () => {
    render(
      <SelectionInlineToolbar
        panel="target"
        onCopy={vi.fn()}
        onAddToChat={vi.fn()}
        onRetranslateSelection={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    openAiMenu();
    expect(screen.getByRole('menuitem', { name: 'editor.retranslateSelection' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'editor.polishSelection' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'editor.reviewSelection' })).toBeNull();
  });
});
