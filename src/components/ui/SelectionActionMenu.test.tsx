import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionActionMenu } from './SelectionActionMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('SelectionActionMenu', () => {
  it('선택 영역을 클립보드에 복사하는 메뉴를 표시하고 실행한다', () => {
    const onCopy = vi.fn();

    render(
      <SelectionActionMenu
        onCopy={onCopy}
        onAddToChat={vi.fn()}
        onAddComment={vi.fn()}
        onViewComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'editor.copySelection' }));

    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
