import { useTranslation } from 'react-i18next';
import type {
  ForbiddenTermProposal,
  GlossaryEntryProposal,
  ProjectMemoryChangeProposal,
} from '@/types';

interface ProjectKnowledgeProposalCardsProps {
  memory: ProjectMemoryChangeProposal | undefined;
  forbiddenTerm: ForbiddenTermProposal | undefined;
  glossaryEntry: GlossaryEntryProposal | undefined;
  onApplyMemory: (mode: 'requested' | 'add') => void;
  onApplyForbiddenTerm: () => void;
  onApplyGlossaryEntry: () => void;
  onDismissMemory: () => void;
  onDismissForbiddenTerm: () => void;
  onDismissGlossaryEntry: () => void;
}

function ActionButton({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`rounded-lg px-2.5 py-1.5 text-xs ${
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

export function ProjectKnowledgeProposalCards({
  memory,
  forbiddenTerm,
  glossaryEntry,
  onApplyMemory,
  onApplyForbiddenTerm,
  onApplyGlossaryEntry,
  onDismissMemory,
  onDismissForbiddenTerm,
  onDismissGlossaryEntry,
}: ProjectKnowledgeProposalCardsProps): JSX.Element | null {
  const { t } = useTranslation();
  const hasProposal =
    memory?.status === 'proposed' ||
    forbiddenTerm?.status === 'proposed' ||
    glossaryEntry?.status === 'proposed';
  if (!hasProposal) return null;

  return (
    <div className="mt-3 space-y-2">
      {memory?.status === 'proposed' && (
        <div className="rounded-xl border border-editor-border bg-editor-bg p-3">
          <div className="text-[10px] font-semibold uppercase text-editor-muted">
            {t('memory.proposalTitle', '프로젝트 메모리 업데이트 제안')}
          </div>
          <div className="mt-1 text-xs text-editor-muted">{memory.category}</div>
          {memory.content && (
            <div className="mt-1 whitespace-pre-wrap text-sm text-editor-text">
              {memory.content}
            </div>
          )}
          {memory.reason && <div className="mt-1 text-xs text-editor-muted">{memory.reason}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton primary onClick={() => onApplyMemory('requested')}>
              {memory.operation === 'archive'
                ? t('memory.archive', '보관')
                : memory.operation === 'replace'
                  ? t('memory.update', '업데이트')
                  : t('memory.add', '추가')}
            </ActionButton>
            {memory.operation === 'replace' && (
              <ActionButton onClick={() => onApplyMemory('add')}>
                {t('memory.addAsNew', '새 항목으로 추가')}
              </ActionButton>
            )}
            <ActionButton onClick={onDismissMemory}>{t('common.ignore')}</ActionButton>
          </div>
        </div>
      )}

      {forbiddenTerm?.status === 'proposed' && (
        <div className="rounded-xl border border-editor-border bg-editor-bg p-3">
          <div className="text-[10px] font-semibold uppercase text-editor-muted">
            {t('memory.forbiddenTermProposal', '금칙어 제안')}
          </div>
          <div className="mt-1 text-sm text-editor-text">
            {forbiddenTerm.term}
            {forbiddenTerm.replacement ? ` → ${forbiddenTerm.replacement}` : ''}
          </div>
          <div className="mt-3 flex gap-2">
            <ActionButton primary onClick={onApplyForbiddenTerm}>
              {t('memory.add', '추가')}
            </ActionButton>
            <ActionButton onClick={onDismissForbiddenTerm}>{t('common.ignore')}</ActionButton>
          </div>
        </div>
      )}

      {glossaryEntry?.status === 'proposed' && (
        <div className="rounded-xl border border-editor-border bg-editor-bg p-3">
          <div className="text-[10px] font-semibold uppercase text-editor-muted">
            {t('memory.glossaryProposal', '용어집 항목 제안')}
          </div>
          <div className="mt-1 text-sm text-editor-text">
            {glossaryEntry.source} = {glossaryEntry.target}
          </div>
          <div className="mt-3 flex gap-2">
            <ActionButton primary onClick={onApplyGlossaryEntry}>
              {t('memory.add', '추가')}
            </ActionButton>
            <ActionButton onClick={onDismissGlossaryEntry}>{t('common.ignore')}</ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}
