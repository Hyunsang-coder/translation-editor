import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HistorySnapshotMeta } from '@/types';
import { HistoryTimeline, CURRENT_STATE_ID } from './HistoryTimeline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko' },
  }),
}));

const now = Date.now();
const snapshots: HistorySnapshotMeta[] = [
  { id: 's1', timestamp: now - 3000, description: 'Snapshot A' },
  { id: 's2', timestamp: now - 1000, description: 'Snapshot B' },
];

const defaultProps = {
  snapshots,
  selectedIds: [CURRENT_STATE_ID],
  onToggleSelect: vi.fn(),
  onRestore: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
};

describe('HistoryTimeline', () => {
  it('"현재 상태" 가상 항목이 최상단에 표시된다', () => {
    render(<HistoryTimeline {...defaultProps} />);

    const items = screen.getAllByRole('listitem');
    // 첫 번째 항목 = 현재 상태, 나머지 = 스냅샷(최신순)
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('history.currentState');
  });

  it('스냅샷이 최신순으로 정렬된다', () => {
    render(<HistoryTimeline {...defaultProps} />);

    const items = screen.getAllByRole('listitem');
    // items[1] = Snapshot B (newer), items[2] = Snapshot A (older)
    expect(items[1]).toHaveTextContent('Snapshot B');
    expect(items[2]).toHaveTextContent('Snapshot A');
  });

  it('체크박스 클릭 시 onToggleSelect가 호출된다', async () => {
    const onToggleSelect = vi.fn();
    const user = userEvent.setup();

    render(<HistoryTimeline {...defaultProps} onToggleSelect={onToggleSelect} />);

    const checkboxes = screen.getAllByRole('checkbox');
    // checkboxes[0] = 현재 상태, [1] = Snapshot B, [2] = Snapshot A
    await user.click(checkboxes[2]!);

    expect(onToggleSelect).toHaveBeenCalledWith('s1');
  });

  it('"현재 상태" 체크박스 클릭 시 CURRENT_STATE_ID로 호출된다', async () => {
    const onToggleSelect = vi.fn();
    const user = userEvent.setup();

    render(<HistoryTimeline {...defaultProps} onToggleSelect={onToggleSelect} />);

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]!);

    expect(onToggleSelect).toHaveBeenCalledWith(CURRENT_STATE_ID);
  });

  it('2개 선택 시 미선택 체크박스가 disabled 된다', () => {
    render(
      <HistoryTimeline
        {...defaultProps}
        selectedIds={[CURRENT_STATE_ID, 's2']}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    // 현재 상태: checked, not disabled
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[0]).not.toBeDisabled();
    // Snapshot B: checked, not disabled
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[1]).not.toBeDisabled();
    // Snapshot A: unchecked, disabled
    expect(checkboxes[2]).not.toBeChecked();
    expect(checkboxes[2]).toBeDisabled();
  });

  it('선택된 항목에 하이라이트 클래스가 적용된다', () => {
    render(
      <HistoryTimeline
        {...defaultProps}
        selectedIds={[CURRENT_STATE_ID, 's1']}
      />,
    );

    const items = screen.getAllByRole('listitem');
    // 현재 상태 (selected)
    expect(items[0]!.className).toContain('bg-primary-500/10');
    // Snapshot B (not selected)
    expect(items[1]!.className).not.toContain('bg-primary-500/10');
    // Snapshot A (selected)
    expect(items[2]!.className).toContain('bg-primary-500/10');
  });

  it('Compare 버튼이 존재하지 않는다 (체크박스로 대체)', () => {
    render(<HistoryTimeline {...defaultProps} />);

    expect(screen.queryByText('history.compare')).toBeNull();
  });

  it('Restore/Rename/Delete 버튼은 정상 동작한다', async () => {
    const onRestore = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <HistoryTimeline
        {...defaultProps}
        onRestore={onRestore}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );

    const restoreButtons = screen.getAllByText('history.restore');
    const renameButtons = screen.getAllByText('history.rename');
    const deleteButtons = screen.getAllByText('history.delete');

    await user.click(restoreButtons[0]!); // Snapshot B (newest first)
    expect(onRestore).toHaveBeenCalledWith('s2');

    await user.click(renameButtons[1]!); // Snapshot A
    expect(onRename).toHaveBeenCalledWith('s1');

    await user.click(deleteButtons[0]!); // Snapshot B
    expect(onDelete).toHaveBeenCalledWith('s2');
  });

  it('로딩 중에는 로딩 메시지를 표시한다', () => {
    render(<HistoryTimeline {...defaultProps} isLoading />);

    expect(screen.getByText('history.loading')).toBeDefined();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('스냅샷이 비어있으면 빈 메시지를 표시한다', () => {
    render(<HistoryTimeline {...defaultProps} snapshots={[]} />);

    expect(screen.getByText('history.empty')).toBeDefined();
  });
});
