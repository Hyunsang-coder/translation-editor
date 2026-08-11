import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useHistoryStore } from '@/stores/historyStore';
import { countTotalWords } from '@/utils/wordCounter';

/** 상대 시간 표시가 굳지 않도록 1분마다 리렌더 */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 에디터 상단 상태 스트립.
 *
 * 검수 진행률 / 저장 상태 / 최신 스냅샷 / 단어 수를 한 줄에 모은다.
 * 전부 기존 스토어에서 파생하며 새 스토어 필드를 만들지 않는다.
 * 단어 수는 이전에 Source/Target 패널 헤더에 각각 있던 값을 여기로 옮긴 것이다.
 */
export function StatusStrip(): JSX.Element {
  const { t } = useTranslation();
  const now = useMinuteTick();

  const { isDirty, lastSavedAt, sourceDocument, targetDocument, projectId } = useProjectStore(
    useShallow((s) => ({
      isDirty: s.isDirty,
      lastSavedAt: s.lastSavedAt,
      sourceDocument: s.sourceDocument,
      targetDocument: s.targetDocument,
      projectId: s.project?.id ?? null,
    }))
  );

  const { isReviewing, progress } = useReviewStore(
    useShallow((s) => ({ isReviewing: s.isReviewing, progress: s.progress }))
  );

  const snapshots = useHistoryStore((s) => s.snapshots);
  const snapshotsProjectId = useHistoryStore((s) => s.snapshotsProjectId);

  // 문서는 타이핑마다 바뀌므로 카운트를 300ms 디바운스한다 (기존 패널 헤더 로직과 동일).
  const [sourceWords, setSourceWords] = useState(0);
  const [targetWords, setTargetWords] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSourceWords(sourceDocument ? countTotalWords(sourceDocument) : 0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [sourceDocument]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTargetWords(targetDocument ? countTotalWords(targetDocument) : 0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [targetDocument]);

  const latestSnapshot = useMemo(() => {
    if (projectId && snapshotsProjectId !== null && snapshotsProjectId !== projectId) return null;
    if (snapshots.length === 0) return null;
    return snapshots.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  }, [snapshots, snapshotsProjectId, projectId]);

  const snapshotAgeLabel = useMemo(() => {
    if (!latestSnapshot) return null;
    const minutes = Math.max(0, Math.floor((now - latestSnapshot.timestamp) / 60_000));
    return minutes < 1
      ? t('status.snapshotJustNow')
      : t('status.snapshotAgo', { minutes });
  }, [latestSnapshot, now, t]);

  const reviewPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div
      className="flex-1 min-w-0 flex items-center gap-5 text-xs text-editor-muted"
      data-testid="status-strip"
    >
      {isReviewing && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-semibold text-editor-text">{t('status.reviewing')}</span>
          <span className="w-24 h-[5px] bg-editor-border rounded-sm overflow-hidden" aria-hidden="true">
            <span
              className="block h-full bg-primary-fill transition-[width] duration-150"
              style={{ width: `${reviewPercent}%` }}
            />
          </span>
          <span className="tabular-nums">{progress.completed}/{progress.total}</span>
        </div>
      )}

      <span className="shrink-0 truncate">
        {isDirty
          ? t('status.saving')
          : lastSavedAt > 0
            ? `${t('status.saved')} · ${formatClock(lastSavedAt)}`
            : t('status.notSavedYet')}
      </span>

      {snapshotAgeLabel && (
        <span className="min-w-0 truncate">
          {snapshotAgeLabel}
          {latestSnapshot?.description ? ` (${latestSnapshot.description})` : ''}
        </span>
      )}

      <span className="ml-auto shrink-0 tabular-nums">
        {t('status.sourceWords', { words: sourceWords.toLocaleString() })}
        {' · '}
        {t('status.targetWords', { words: targetWords.toLocaleString() })}
      </span>
    </div>
  );
}
