import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { countTotalWords } from '@/utils/wordCounter';

/**
 * 에디터 상단 상태 스트립.
 *
 * 검수 진행률 / 저장 실패 / 단어 수를 한 줄에 모은다.
 * 전부 기존 스토어에서 파생하며 새 스토어 필드를 만들지 않는다.
 *
 * 평상시 저장 상태는 보여주지 않는다 — 편집이 멈추면 write-through(0.5초)와 autosave 루프가
 * 곧바로 저장하므로 "저장 중/저장됨"은 깜빡임일 뿐이다. 스냅샷 시각은 히스토리 패널의 몫이다.
 * 단어 수는 이전에 Source/Target 패널 헤더에 각각 있던 값을 여기로 옮긴 것이다.
 */
export function StatusStrip(): JSX.Element {
  const { t } = useTranslation();

  const { saveStatus, lastSaveError, lastSavedAt, sourceDocument, targetDocument, projectId } = useProjectStore(
    useShallow((s) => ({
      saveStatus: s.saveStatus,
      lastSaveError: s.lastSaveError,
      lastSavedAt: s.lastSavedAt,
      sourceDocument: s.sourceDocument,
      targetDocument: s.targetDocument,
      projectId: s.project?.id ?? null,
    }))
  );

  const { isReviewing, progress } = useReviewStore(
    useShallow((s) => ({ isReviewing: s.isReviewing, progress: s.progress }))
  );

  // 실패 후 autosave가 재시도할 때마다 saveOnce가 saveStatus를 'saving'으로, lastSaveError를 null로
  // 되돌린다. saveStatus를 그대로 따라가면 경고가 재시도 주기로 깜빡이므로, 실패는 여기서 붙잡아 두고
  // 저장이 실제로 성공(lastSavedAt 갱신)하거나 프로젝트가 바뀔 때만 지운다.
  // 지우는 effect가 먼저 선언돼야 한다 — 이미 실패 상태로 마운트될 때 경고가 곧바로 지워지지 않도록.
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  useEffect(() => {
    setSaveFailure(null);
  }, [lastSavedAt, projectId]);
  useEffect(() => {
    if (saveStatus === 'error') setSaveFailure(lastSaveError ?? '');
  }, [saveStatus, lastSaveError]);

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

      {saveFailure !== null && (
        <span
          className="flex min-w-0 items-center gap-1 text-severity-critical"
          title={saveFailure || undefined}
          role="status"
          data-testid="status-save-failed"
        >
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">{t('status.saveFailedRetrying')}</span>
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
