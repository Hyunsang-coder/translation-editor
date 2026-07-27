import { useTranslation } from 'react-i18next';
import type {
  ForbiddenTermProposal,
  GlossaryEntryProposal,
  ProjectMemoryChangeProposal,
} from '@/types';
import type { KnowledgeProposalKind } from './knowledgeProposals';

interface ProjectKnowledgeProposalCardsProps {
  memoryProposals: ProjectMemoryChangeProposal[];
  forbiddenTermProposals: ForbiddenTermProposal[];
  glossaryEntryProposals: GlossaryEntryProposal[];
  onApplyMemory: (proposal: ProjectMemoryChangeProposal, mode: 'requested' | 'add') => void;
  onApplyForbiddenTerm: (proposal: ForbiddenTermProposal) => void;
  onApplyGlossaryEntry: (proposal: GlossaryEntryProposal) => void;
  onDismiss: (kind: KnowledgeProposalKind, proposalId: string) => void;
  /** 저장이 진행 중이면 승인 버튼을 잠가 중복 쓰기를 막는다. */
  busy?: boolean;
}

function ActionButton({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? 'bg-primary-500 font-medium text-white hover:bg-primary-600'
          : 'border border-editor-border text-editor-muted hover:bg-editor-border/60'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function isPending(proposal: { status: 'proposed' | 'applied' | 'dismissed' }): boolean {
  return proposal.status === 'proposed';
}

export function ProjectKnowledgeProposalCards({
  memoryProposals,
  forbiddenTermProposals,
  glossaryEntryProposals,
  onApplyMemory,
  onApplyForbiddenTerm,
  onApplyGlossaryEntry,
  onDismiss,
  busy = false,
}: ProjectKnowledgeProposalCardsProps): JSX.Element | null {
  const { t } = useTranslation();
  const memory = memoryProposals.filter(isPending);
  const forbiddenTerms = forbiddenTermProposals.filter(isPending);
  const glossaryEntries = glossaryEntryProposals.filter(isPending);
  if (memory.length === 0 && forbiddenTerms.length === 0 && glossaryEntries.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {memory.map((proposal) => (
        <div
          key={proposal.proposalId}
          className="rounded-xl border border-editor-border bg-editor-bg p-3"
        >
          <div className="text-[10px] font-semibold uppercase text-editor-muted">
            {t('memory.proposalTitle', '프로젝트 메모리 업데이트 제안')}
          </div>
          <div className="mt-1 text-xs text-editor-muted">{proposal.category}</div>
          {proposal.content && (
            <div className="mt-1 whitespace-pre-wrap text-sm text-editor-text">
              {proposal.content}
            </div>
          )}
          {proposal.reason && (
            <div className="mt-1 text-xs text-editor-muted">{proposal.reason}</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              primary
              disabled={busy}
              onClick={() => onApplyMemory(proposal, 'requested')}
            >
              {proposal.operation === 'archive'
                ? t('memory.archive', '보관')
                : proposal.operation === 'replace'
                  ? t('memory.update', '업데이트')
                  : t('memory.add', '추가')}
            </ActionButton>
            {proposal.operation === 'replace' && (
              <ActionButton disabled={busy} onClick={() => onApplyMemory(proposal, 'add')}>
                {t('memory.addAsNew', '새 항목으로 추가')}
              </ActionButton>
            )}
            <ActionButton onClick={() => onDismiss('memory', proposal.proposalId)}>
              {t('common.ignore')}
            </ActionButton>
          </div>
        </div>
      ))}

      {forbiddenTerms.map((proposal) => (
        <div
          key={proposal.proposalId}
          className="rounded-xl border border-editor-border bg-editor-bg p-3"
        >
          <div className="text-[10px] font-semibold uppercase text-editor-muted">
            {t('memory.forbiddenTermProposal', '금칙어 제안')}
          </div>
          <div className="mt-1 text-sm text-editor-text">
            {proposal.term}
            {proposal.replacement ? ` → ${proposal.replacement}` : ''}
          </div>
          <div className="mt-3 flex gap-2">
            <ActionButton primary disabled={busy} onClick={() => onApplyForbiddenTerm(proposal)}>
              {t('memory.add', '추가')}
            </ActionButton>
            <ActionButton onClick={() => onDismiss('forbiddenTerm', proposal.proposalId)}>
              {t('common.ignore')}
            </ActionButton>
          </div>
        </div>
      ))}

      {glossaryEntries.map((proposal) => (
        <div
          key={proposal.proposalId}
          className="rounded-xl border border-editor-border bg-editor-bg p-3"
        >
          <div className="text-[10px] font-semibold uppercase text-editor-muted">
            {t('memory.glossaryProposal', '용어집 항목 제안')}
          </div>
          <div className="mt-1 text-sm text-editor-text">
            {proposal.source} = {proposal.target}
          </div>
          <div className="mt-3 flex gap-2">
            <ActionButton primary disabled={busy} onClick={() => onApplyGlossaryEntry(proposal)}>
              {t('memory.add', '추가')}
            </ActionButton>
            <ActionButton onClick={() => onDismiss('glossaryEntry', proposal.proposalId)}>
              {t('common.ignore')}
            </ActionButton>
          </div>
        </div>
      ))}
    </div>
  );
}
