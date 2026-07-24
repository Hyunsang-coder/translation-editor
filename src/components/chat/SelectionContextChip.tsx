import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SelectionAnchorStatus, SelectionPanel } from '@/types';

interface SelectionContextChipProps {
  selection: {
    panel: SelectionPanel;
    text: string;
    status: SelectionAnchorStatus;
  };
  onDismiss?: () => void;
  compact?: boolean;
}

export function SelectionContextChip({
  selection,
  onDismiss,
  compact = false,
}: SelectionContextChipProps): JSX.Element {
  const { t } = useTranslation();
  const statusNeedsAttention =
    selection.status === 'stale' ||
    selection.status === 'detached' ||
    selection.status === 'dismissed';

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        statusNeedsAttention
          ? 'border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20'
          : 'border-primary-300/70 bg-primary-50/50 dark:bg-primary-950/20'
      }`}
      data-testid="selection-context-chip"
      data-selection-status={selection.status}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-editor-text">
          {selection.panel === 'source' ? 'Source' : 'Target'} · {selection.text.length}
          {t('selection.characters', '자')}
        </span>
        {selection.status !== 'active' && (
          <span className="rounded-full bg-editor-bg px-1.5 py-0.5 text-[10px] text-editor-muted">
            {t(`selection.status.${selection.status}`)}
          </span>
        )}
        {onDismiss && (
          <button
            type="button"
            className="ml-auto rounded p-0.5 text-editor-muted hover:bg-editor-border/60 hover:text-editor-text"
            aria-label={t('selection.dismiss')}
            title={t('selection.dismiss')}
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className={`mt-1 text-xs text-editor-muted ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>
        “{selection.text}”
      </div>
    </div>
  );
}
