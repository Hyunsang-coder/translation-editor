import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectKnowledgeProposalCards } from './ProjectKnowledgeProposalCards';
import type { ProjectMemoryChangeProposal } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

function memoryProposal(
  proposalId: string,
  overrides: Partial<ProjectMemoryChangeProposal> = {},
): ProjectMemoryChangeProposal {
  return {
    proposalId,
    projectId: 'project-1',
    operation: 'add',
    category: 'domain',
    content: `내용 ${proposalId}`,
    sourceSessionId: 'session-1',
    status: 'proposed',
    ...overrides,
  };
}

function renderCards(
  props: Partial<React.ComponentProps<typeof ProjectKnowledgeProposalCards>> = {},
) {
  const onApplyMemory = vi.fn();
  const onDismiss = vi.fn();
  const result = render(
    <ProjectKnowledgeProposalCards
      memoryProposals={[]}
      forbiddenTermProposals={[]}
      glossaryEntryProposals={[]}
      onApplyMemory={onApplyMemory}
      onApplyForbiddenTerm={vi.fn()}
      onApplyGlossaryEntry={vi.fn()}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  return { ...result, onApplyMemory, onDismiss };
}

describe('ProjectKnowledgeProposalCards', () => {
  it('제안이 여러 건이면 카드를 모두 렌더링한다 (D3)', () => {
    const { container } = renderCards({
      memoryProposals: [memoryProposal('p1'), memoryProposal('p2')],
      forbiddenTermProposals: [
        { proposalId: 'f1', term: '유저', replacement: '플레이어', status: 'proposed' },
      ],
    });

    expect(container).toHaveTextContent('내용 p1');
    expect(container).toHaveTextContent('내용 p2');
    expect(container).toHaveTextContent('유저 → 플레이어');
  });

  it('승인/무시된 제안은 표시하지 않는다', () => {
    const { container } = renderCards({
      memoryProposals: [
        memoryProposal('p1', { status: 'applied' }),
        memoryProposal('p2', { status: 'dismissed' }),
        memoryProposal('p3'),
      ],
    });

    expect(container).not.toHaveTextContent('내용 p1');
    expect(container).not.toHaveTextContent('내용 p2');
    expect(container).toHaveTextContent('내용 p3');
  });

  it('전부 처리됐으면 아무것도 렌더링하지 않는다', () => {
    const { container } = renderCards({
      memoryProposals: [memoryProposal('p1', { status: 'applied' })],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('클릭한 카드의 제안만 콜백으로 전달한다 (D3)', () => {
    const { onApplyMemory, onDismiss } = renderCards({
      memoryProposals: [memoryProposal('p1'), memoryProposal('p2')],
    });

    fireEvent.click(screen.getAllByRole('button', { name: '추가' })[1]!);
    expect(onApplyMemory).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p2' }),
      'requested',
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'common.ignore' })[0]!);
    expect(onDismiss).toHaveBeenCalledWith('memory', 'p1');
  });

  it('replace 제안은 새 항목으로 추가 선택지를 제공한다', () => {
    const { onApplyMemory } = renderCards({
      memoryProposals: [memoryProposal('p1', { operation: 'replace', targetItemId: 'item-1' })],
    });

    fireEvent.click(screen.getByRole('button', { name: '새 항목으로 추가' }));
    expect(onApplyMemory).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'p1' }),
      'add',
    );
  });

  it('저장 중이면 승인 버튼을 잠근다 (D5)', () => {
    const { onApplyMemory, onDismiss } = renderCards({
      memoryProposals: [memoryProposal('p1')],
      busy: true,
    });

    const apply = screen.getByRole('button', { name: '추가' });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApplyMemory).not.toHaveBeenCalled();

    // 무시는 쓰기가 아니므로 계속 가능해야 한다
    fireEvent.click(screen.getByRole('button', { name: 'common.ignore' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
