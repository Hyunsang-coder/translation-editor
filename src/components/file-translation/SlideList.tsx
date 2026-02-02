import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

export interface SlideItem {
  index: number;
  title?: string | undefined;
  textPreview: string;
  status: 'pending' | 'translating' | 'done' | 'error';
}

interface SlideListProps {
  slides: SlideItem[];
  onSlideClick?: (index: number) => void;
}

/**
 * 추출된 슬라이드 목록을 표시하는 컴포넌트
 * - 슬라이드 번호, 제목 (있으면), 텍스트 프리뷰
 * - 번역 상태 표시 (pending, translating, done, error)
 * - 클릭하면 상세 보기 (나중에 구현)
 */
export function SlideList({ slides, onSlideClick }: SlideListProps): JSX.Element {
  const { t } = useTranslation();

  const handleSlideClick = useCallback((index: number) => {
    onSlideClick?.(index);
  }, [onSlideClick]);

  const getStatusIcon = (status: SlideItem['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-editor-muted" />;
      case 'translating':
        return <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />;
      case 'done':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusLabel = (status: SlideItem['status']) => {
    switch (status) {
      case 'pending':
        return t('fileTranslation.slideList.status.pending', '대기 중');
      case 'translating':
        return t('fileTranslation.slideList.status.translating', '번역 중');
      case 'done':
        return t('fileTranslation.slideList.status.done', '완료');
      case 'error':
        return t('fileTranslation.slideList.status.error', '오류');
      default:
        return '';
    }
  };

  if (slides.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-editor-muted text-sm">
          {t('fileTranslation.slideList.empty', '슬라이드가 없습니다.')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        {slides.map((slide) => (
          <button
            key={slide.index}
            type="button"
            onClick={() => handleSlideClick(slide.index)}
            className={`
              w-full text-left p-3 rounded-lg border transition-all
              ${slide.status === 'translating'
                ? 'border-primary-500/50 bg-primary-500/5'
                : slide.status === 'error'
                  ? 'border-red-500/50 bg-red-500/5'
                  : 'border-editor-border hover:border-editor-border/80 hover:bg-editor-surface/50'
              }
            `}
          >
            <div className="flex items-start gap-3">
              {/* 슬라이드 번호 */}
              <div className="shrink-0 w-8 h-8 rounded bg-editor-surface flex items-center justify-center text-sm font-medium text-editor-muted">
                {slide.index + 1}
              </div>

              {/* 콘텐츠 */}
              <div className="flex-1 min-w-0">
                {/* 제목 */}
                {slide.title && (
                  <h4 className="text-sm font-medium text-editor-text truncate mb-1">
                    {slide.title}
                  </h4>
                )}

                {/* 텍스트 프리뷰 */}
                <p className="text-xs text-editor-muted line-clamp-2">
                  {slide.textPreview || t('fileTranslation.slideList.noText', '(텍스트 없음)')}
                </p>
              </div>

              {/* 상태 */}
              <div className="shrink-0 flex items-center gap-1.5">
                {getStatusIcon(slide.status)}
                <span className="text-xs text-editor-muted hidden sm:inline">
                  {getStatusLabel(slide.status)}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
