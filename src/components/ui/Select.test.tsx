import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

describe('Select footerAction', () => {
  const options = [
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai', label: 'OpenAI' },
  ];

  it('동작 항목을 고르면 onSelect만 부르고 선택 값은 건드리지 않는다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelect = vi.fn();

    render(
      <Select
        value="anthropic"
        onChange={onChange}
        options={options}
        footerAction={{ label: '상세 설정…', onSelect }}
        data-testid="provider-select"
      />,
    );

    await user.click(screen.getByTestId('provider-select'));
    await user.click(screen.getByText('상세 설정…'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('일반 옵션 선택은 그대로 onChange로 간다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Select
        value="anthropic"
        onChange={onChange}
        options={options}
        footerAction={{ label: '상세 설정…', onSelect: vi.fn() }}
        data-testid="provider-select"
      />,
    );

    await user.click(screen.getByTestId('provider-select'));
    await user.click(screen.getByText('OpenAI'));

    expect(onChange).toHaveBeenCalledWith('openai');
  });
});
