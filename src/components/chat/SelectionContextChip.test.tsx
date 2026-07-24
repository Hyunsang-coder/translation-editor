import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionContextChip } from './SelectionContextChip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('SelectionContextChip', () => {
  const selection = {
    panel: 'target' as const,
    text: '서비스는 점검이 완료될 때까지 이용할 수 없습니다.',
    status: 'active' as const,
  };

  it('패널, 글자 수, excerpt를 카드로 표시한다', () => {
    render(<SelectionContextChip selection={selection} />);

    expect(screen.getByText(/Target/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${selection.text.length}`))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes(selection.text))).toBeInTheDocument();
  });

  it('stale 상태를 표시하고 해제할 수 있다', () => {
    const onDismiss = vi.fn();
    render(
      <SelectionContextChip
        selection={{ ...selection, status: 'stale' }}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText('selection.status.stale')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'selection.dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
