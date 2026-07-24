import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionEditProposalCard } from './SelectionEditProposalCard';
import type { SelectionEditProposal } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const proposal: SelectionEditProposal = {
  proposalId: 'proposal-1',
  selectionId: 'selection-1',
  selectionScopeId: 'scope-1',
  projectId: 'project-1',
  panel: 'target',
  anchorId: 'anchor-1',
  originalText: '기존 번역',
  replacementText: '개선된 번역',
  operation: 'rewrite',
  documentRevisionAtRequest: 'revision-1',
  status: 'proposed',
  createdAt: 1,
};

describe('SelectionEditProposalCard', () => {
  it('구조화 proposal에만 미리보기와 폐기 동작을 제공한다', () => {
    const onPreview = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <SelectionEditProposalCard
        proposal={proposal}
        onPreview={onPreview}
        onDismiss={onDismiss}
      />,
    );

    expect(container).toHaveTextContent('개선된 번역');
    fireEvent.click(screen.getByRole('button', { name: 'selection.preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'selection.dismissProposal' }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
