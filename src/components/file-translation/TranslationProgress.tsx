import { useTranslation } from 'react-i18next';
import { Play, Square, Loader2 } from 'lucide-react';

interface TranslationProgressProps {
  total: number;
  completed: number;
  isTranslating: boolean;
  onStart: () => void;
  onStop: () => void;
}

/**
 * 번역 진행률을 표시하는 컴포넌트
 * - 전체 슬라이드 수 vs 완료된 슬라이드 수
 * - 프로그레스 바
 * - 시작/중지 버튼
 */
export function TranslationProgress({
  total,
  completed,
  isTranslating,
  onStart,
  onStop,
}: TranslationProgressProps): JSX.Element {
  const { t } = useTranslation();

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isCompleted = completed === total && total > 0;

  return (
    <div className="shrink-0 border-t border-editor-border bg-editor-surface/50 p-4">
      <div className="flex items-center gap-4">
        {/* 진행률 정보 */}
        <div className="flex-1 min-w-0">
          {/* 상태 텍스트 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-editor-text">
              {isTranslating
                ? t('fileTranslation.progress.translating', '번역 중...')
                : isCompleted
                  ? t('fileTranslation.progress.completed', '번역 완료')
                  : t('fileTranslation.progress.ready', '번역 준비됨')}
            </span>
            <span className="text-sm text-editor-muted tabular-nums">
              {completed}/{total} {t('fileTranslation.progress.slides', '슬라이드')}
              {' '}({percentage}%)
            </span>
          </div>

          {/* 프로그레스 바 */}
          <div className="w-full h-2 bg-editor-border rounded-full overflow-hidden">
            <div
              className={`
                h-full transition-all duration-300 rounded-full
                ${isCompleted
                  ? 'bg-emerald-500'
                  : isTranslating
                    ? 'bg-primary-500'
                    : 'bg-editor-muted'
                }
              `}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        {/* 컨트롤 버튼 */}
        <div className="shrink-0">
          {isTranslating ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
              aria-label={t('fileTranslation.progress.stop', '중지')}
            >
              <Square className="w-4 h-4" />
              <span className="text-sm font-medium">
                {t('fileTranslation.progress.stop', '중지')}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={total === 0}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                ${isCompleted
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                  : 'bg-primary-500 text-white hover:bg-primary-600'
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              aria-label={
                isCompleted
                  ? t('fileTranslation.progress.reTranslate', '다시 번역')
                  : t('fileTranslation.progress.start', '번역 시작')
              }
            >
              {isTranslating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span className="text-sm font-medium">
                {isCompleted
                  ? t('fileTranslation.progress.reTranslate', '다시 번역')
                  : t('fileTranslation.progress.start', '번역 시작')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
