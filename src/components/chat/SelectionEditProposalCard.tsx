import { useTranslation } from 'react-i18next';
import type { SelectionEditProposal } from '@/types';

interface SelectionEditProposalCardProps {
  proposal: SelectionEditProposal;
  onPreview: () => void;
  onDismiss: () => void;
}

export function SelectionEditProposalCard({
  proposal,
  onPreview,
  onDismiss,
}: SelectionEditProposalCardProps): JSX.Element {
  const { t } = useTranslation();
  const isActionable = proposal.status === 'proposed' || proposal.status === 'previewing';

  return (
    <div className="mt-3 rounded-xl border border-primary-300/70 bg-editor-bg p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-editor-muted">
        {t('selection.proposal', '수정안')}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-editor-text">
        “{proposal.replacementText}”
      </div>
      {proposal.explanation && (
        <div className="mt-1 text-xs text-editor-muted">{proposal.explanation}</div>
      )}
      {isActionable ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-primary-fill px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-fill-hover"
            onClick={onPreview}
          >
            {t('selection.preview')}
          </button>
          <button
            type="button"
            className="rounded-lg border border-editor-border px-2.5 py-1.5 text-xs text-editor-muted hover:bg-editor-border/60"
            onClick={onDismiss}
          >
            {t('selection.dismissProposal')}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-editor-muted">
          {t(`selection.status.${proposal.status}`)}
        </div>
      )}
    </div>
  );
}
