import { Clipboard, Languages, MessagesSquare, NotebookPen, ScanSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SelectionPanel } from '@/types';
import { shortcutLabel } from '@/utils/platform';

/** 인라인 선택 툴바 높이(px) — 선택 영역 위 배치 계산에 쓰인다 */
export const SELECTION_INLINE_TOOLBAR_HEIGHT = 34;

interface SelectionInlineToolbarProps {
  panel?: SelectionPanel;
  onCopy: () => void;
  onAddToChat: () => void;
  onRetranslateSelection?: () => void;
  /** target 패널 전용 — 선택 구간만 검수 */
  onReviewSelection?: () => void;
  onAddComment: () => void;
  style?: React.CSSProperties;
  /** 렌더 후 실제 폭을 재서 화면 안으로 밀어 넣기 위한 ref */
  containerRef?: React.RefObject<HTMLDivElement>;
}

/**
 * 텍스트를 선택하면 선택 영역 위에 자동으로 뜨는 가로 액션 바.
 *
 * 폭은 `w-max`로 고정한다. position:fixed 요소는 기본이 shrink-to-fit이라
 * 오른쪽 끝 근처에서 남은 공간만큼 좁아지고, 그러면 라벨이 줄바꿈되면서
 * `overflow-hidden`에 잘려 정렬이 무너진다.
 */
export function SelectionInlineToolbar({
  panel = 'source',
  onCopy,
  onAddToChat,
  onRetranslateSelection,
  onReviewSelection,
  onAddComment,
  style,
  containerRef,
}: SelectionInlineToolbarProps): JSX.Element {
  const { t } = useTranslation();

  const itemClassName = 'h-[34px] px-3 flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition-colors';

  return (
    <div
      ref={containerRef}
      data-testid={`selection-inline-toolbar-${panel}`}
      style={style}
      className="flex w-max items-stretch overflow-hidden rounded-md border border-editor-text bg-editor-surface shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {panel === 'target' && onRetranslateSelection && (
        <button
          type="button"
          data-testid="selection-inline-retranslate"
          className={`${itemClassName} bg-primary-fill text-white hover:bg-primary-fill-hover`}
          title={t('editor.retranslateSelection')}
          onClick={onRetranslateSelection}
        >
          <Languages className="w-3.5 h-3.5 shrink-0" />
          <span>{t('editor.retranslateSelection')}</span>
        </button>
      )}

      {panel === 'target' && onReviewSelection && (
        <button
          type="button"
          data-testid="selection-inline-review"
          className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline first:border-l-0`}
          title={t('editor.reviewSelection')}
          onClick={onReviewSelection}
        >
          <ScanSearch className="w-3.5 h-3.5 shrink-0" />
          <span>{t('editor.reviewSelection')}</span>
        </button>
      )}

      <button
        type="button"
        data-testid="selection-inline-add-chat"
        className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline first:border-l-0`}
        title={t('editor.addToChat')}
        onClick={onAddToChat}
      >
        <MessagesSquare className="w-3.5 h-3.5 shrink-0" />
        <span>{t('editor.addToChatLabel')}</span>
        <span className="text-[11px] text-editor-muted">{shortcutLabel('L')}</span>
      </button>

      <button
        type="button"
        data-testid="selection-inline-comment"
        className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
        title={t('comment.addButton')}
        onClick={onAddComment}
      >
        <NotebookPen className="w-3.5 h-3.5 shrink-0" />
        <span>{t('comment.addButton')}</span>
      </button>

      <button
        type="button"
        data-testid="selection-inline-copy"
        className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
        title={t('editor.copySelection')}
        onClick={onCopy}
      >
        <Clipboard className="w-3.5 h-3.5 shrink-0" />
        <span>{t('editor.copySelection')}</span>
      </button>
    </div>
  );
}
