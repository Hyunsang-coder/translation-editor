import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlignmentRow } from '@/components/editor/AlignmentRow';
import type { UnitAnnotations } from '@/components/editor/useAlignmentAnnotations';
import type { AlignOp } from '@/utils/alignUnits';

const op: AlignOp = {
  kind: 'pair',
  source: { id: 's1', type: 'paragraph', path: [0], text: '반동이 감소했습니다.' },
  target: { id: 't1', type: 'paragraph', path: [0], text: 'The recoil was reduced.' },
};

function annotations(overrides: Partial<UnitAnnotations> = {}): UnitAnnotations {
  return {
    issueCount: 2,
    issueIds: ['issue-a', 'issue-b'],
    topSeverity: 'major',
    commentCount: 0,
    ...overrides,
  };
}

function renderRow(props: {
  onNavigateIssue?: ((issueId: string) => void) | null;
  onSelect?: () => void;
  annotations?: UnitAnnotations | null;
}): void {
  render(
    <AlignmentRow
      index={1}
      op={op}
      active={false}
      onSelect={props.onSelect ?? null}
      onEdit={null}
      annotations={props.annotations === undefined ? annotations() : props.annotations}
      onNavigateIssue={props.onNavigateIssue ?? null}
    />,
  );
}

describe('AlignmentRow 이슈 배지', () => {
  it('이슈가 있으면 이동 버튼으로 렌더링되고 aria-label이 붙는다', () => {
    renderRow({ onNavigateIssue: () => undefined });

    const badge = screen.getByTestId('alignment-issue-badge');
    expect(badge.tagName).toBe('BUTTON');
    expect(badge.getAttribute('aria-label')).toBeTruthy();
  });

  it('클릭하면 그 행의 첫 이슈 ID를 전달하고 행 선택은 발생하지 않는다', async () => {
    const onNavigateIssue = vi.fn();
    const onSelect = vi.fn();
    renderRow({ onNavigateIssue, onSelect });

    await userEvent.click(screen.getByTestId('alignment-issue-badge'));

    expect(onNavigateIssue).toHaveBeenCalledWith('issue-a');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('키보드 Enter/Space도 같은 이동을 실행하고 행 선택으로 새지 않는다', async () => {
    const onNavigateIssue = vi.fn();
    const onSelect = vi.fn();
    renderRow({ onNavigateIssue, onSelect });

    screen.getByTestId('alignment-issue-badge').focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    expect(onNavigateIssue).toHaveBeenCalledTimes(2);
    expect(onNavigateIssue).toHaveBeenNthCalledWith(2, 'issue-a');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('이동 콜백이 없으면 버튼이 아니라 표시용 배지로 남는다', () => {
    renderRow({ onNavigateIssue: null });

    expect(screen.getByTestId('alignment-issue-badge').tagName).toBe('SPAN');
  });

  it('연결된 이슈 ID가 없으면 이동 대상이 없으므로 버튼으로 만들지 않는다', () => {
    renderRow({
      onNavigateIssue: () => undefined,
      annotations: annotations({ issueCount: 1, issueIds: [] }),
    });

    expect(screen.getByTestId('alignment-issue-badge').tagName).toBe('SPAN');
  });

  it('이슈가 없으면 배지를 렌더링하지 않는다', () => {
    renderRow({
      onNavigateIssue: () => undefined,
      annotations: annotations({ issueCount: 0, issueIds: [] }),
    });

    expect(screen.queryByTestId('alignment-issue-badge')).toBeNull();
  });
});
