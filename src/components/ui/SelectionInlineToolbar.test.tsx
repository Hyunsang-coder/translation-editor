import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionInlineToolbar } from './SelectionInlineToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

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

  it('Source 선택에는 재번역 액션을 표시하지 않는다', () => {
    render(
      <SelectionInlineToolbar
        panel="source"
        onCopy={vi.fn()}
        onAddToChat={vi.fn()}
        onRetranslateSelection={vi.fn()}
        onAddComment={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'editor.retranslateSelection' })).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: 'editor.retranslateSelection' }));
    expect(onRetranslateSelection).toHaveBeenCalledTimes(1);
  });
});
