import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistorySnapshotMeta } from '@/types';

interface HistoryTimelineProps {
  snapshots: HistorySnapshotMeta[];
  isLoading?: boolean;
  onCompare: (snapshotId: string) => void;
  onRestore: (snapshotId: string) => void;
  onRename: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => void;
}

function formatRelativeTime(
  timestamp: number,
  language: string,
): string {
  const locale = language.startsWith('ko') ? 'ko' : 'en';
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const now = Date.now();
  const diffMs = timestamp - now;
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 60) return formatter.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return formatter.format(diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return formatter.format(diffHour, 'hour');
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 7) return formatter.format(diffDay, 'day');
  const diffWeek = Math.round(diffDay / 7);
  if (Math.abs(diffWeek) < 5) return formatter.format(diffWeek, 'week');
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return formatter.format(diffMonth, 'month');
  const diffYear = Math.round(diffDay / 365);
  return formatter.format(diffYear, 'year');
}

export function HistoryTimeline({
  snapshots,
  isLoading = false,
  onCompare,
  onRestore,
  onRename,
  onDelete,
}: HistoryTimelineProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const sorted = useMemo(
    () => [...snapshots].sort((a, b) => b.timestamp - a.timestamp),
    [snapshots],
  );

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-editor-muted">
        {t('history.loading')}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="p-4 text-sm text-editor-muted">
        {t('history.empty')}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-editor-border">
      {sorted.map((snapshot) => (
        <li key={snapshot.id} className="p-4 space-y-2">
          <div className="text-sm font-medium text-editor-text break-words">
            {snapshot.description}
          </div>
          <div className="text-xs text-editor-muted">
            {formatRelativeTime(snapshot.timestamp, i18n.language)}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onCompare(snapshot.id)}
              className="px-2 py-1 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
            >
              {t('history.compare')}
            </button>
            <button
              type="button"
              onClick={() => onRestore(snapshot.id)}
              className="px-2 py-1 text-xs rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              {t('history.restore')}
            </button>
            <button
              type="button"
              onClick={() => onRename(snapshot.id)}
              className="px-2 py-1 text-xs rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
            >
              {t('history.rename')}
            </button>
            <button
              type="button"
              onClick={() => onDelete(snapshot.id)}
              className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-500 hover:bg-red-500/10 transition-colors"
            >
              {t('history.delete')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
