import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentInstructions } from './RecentInstructions';
import { useInstructionHistoryStore } from '@/stores/instructionHistoryStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

function seed(instructions: string[]): void {
  useInstructionHistoryStore.setState({
    byProject: { 'p1': { documentPolish: instructions } },
  });
}

describe('RecentInstructions', () => {
  beforeEach(() => {
    useInstructionHistoryStore.setState({ byProject: {} });
  });

  it('기록이 없으면 아무것도 그리지 않는다', () => {
    render(
      <RecentInstructions projectId="p1" kind="documentPolish" value="" onPick={vi.fn()} />,
    );

    expect(screen.queryByTestId('recent-instructions')).toBeNull();
  });

  it('빈 입력칸에 누르면 그대로 채운다', () => {
    seed(['더 간결하게']);
    const onPick = vi.fn();
    render(
      <RecentInstructions projectId="p1" kind="documentPolish" value="" onPick={onPick} />,
    );

    fireEvent.click(screen.getByTestId('recent-instruction-chip'));

    expect(onPick).toHaveBeenCalledWith('더 간결하게');
  });

  it('쓰던 내용이 있으면 덮어쓰지 않고 줄바꿈으로 덧붙인다', () => {
    seed(['존댓말 유지']);
    const onPick = vi.fn();
    render(
      <RecentInstructions
        projectId="p1"
        kind="documentPolish"
        value="더 간결하게"
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByTestId('recent-instruction-chip'));

    expect(onPick).toHaveBeenCalledWith('더 간결하게\n존댓말 유지');
  });

  it('이미 들어간 지시문은 누를 수 없다 (중복 방지)', () => {
    seed(['더 간결하게', '존댓말 유지']);
    render(
      <RecentInstructions
        projectId="p1"
        kind="documentPolish"
        value="더 간결하게"
        onPick={vi.fn()}
      />,
    );

    const chips = screen.getAllByTestId('recent-instruction-chip');
    expect(chips[0]).toBeDisabled();
    expect(chips[1]).not.toBeDisabled();
  });

  it('×를 누르면 그 항목만 목록에서 사라진다', () => {
    seed(['더 간결하게', '존댓말 유지']);
    render(
      <RecentInstructions projectId="p1" kind="documentPolish" value="" onPick={vi.fn()} />,
    );

    fireEvent.click(screen.getAllByTestId('recent-instruction-remove')[0]!);

    expect(
      screen.getAllByTestId('recent-instruction-chip').map((chip) => chip.textContent),
    ).toEqual(['존댓말 유지']);
  });

  it('마지막 항목을 지우면 줄 전체가 사라진다', () => {
    seed(['더 간결하게']);
    render(
      <RecentInstructions projectId="p1" kind="documentPolish" value="" onPick={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('recent-instruction-remove'));

    expect(screen.queryByTestId('recent-instructions')).toBeNull();
  });

  it('이미 입력칸에 들어간 항목도 지울 수는 있다', () => {
    seed(['더 간결하게']);
    render(
      <RecentInstructions
        projectId="p1"
        kind="documentPolish"
        value="더 간결하게"
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByTestId('recent-instruction-chip')).toBeDisabled();
    expect(screen.getByTestId('recent-instruction-remove')).not.toBeDisabled();
  });

  it('다른 프로젝트의 기록은 보이지 않는다', () => {
    seed(['더 간결하게']);
    render(
      <RecentInstructions projectId="p2" kind="documentPolish" value="" onPick={vi.fn()} />,
    );

    expect(screen.queryByTestId('recent-instructions')).toBeNull();
  });
});
