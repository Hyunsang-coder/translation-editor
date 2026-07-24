import { Clipboard, Eye, MessagesSquare, NotebookPen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SelectionExistingComment {
  id: string;
  excerpt: string;
}

interface SelectionActionMenuProps {
  existingComments?: SelectionExistingComment[];
  onCopy: () => void;
  onAddToChat: () => void;
  onAddComment: () => void;
  onViewComment: (commentId: string) => void;
  /** 메뉴만 닫기 (텍스트 선택은 유지) */
  onClose: () => void;
  style?: React.CSSProperties;
  className?: string;
}

const ITEM_HEIGHT = 38;
/** 상단 닫기 버튼 헤더 행의 높이(px) */
const CLOSE_HEADER_HEIGHT = 29;

/**
 * 텍스트 선택 후 표시되는 세로 액션 메뉴 (채팅 추가 / 코멘트).
 */
export function SelectionActionMenu({
  existingComments = [],
  onCopy,
  onAddToChat,
  onAddComment,
  onViewComment,
  onClose,
  style,
  className = '',
}: SelectionActionMenuProps): JSX.Element {
  const { t } = useTranslation();
  const hasExisting = existingComments.length > 0;

  const itemClassName = `
    w-full px-3 py-2 flex items-center gap-2.5
    text-sm text-editor-text
    hover:bg-editor-border/60 transition-colors
    text-left
  `.trim();

  const truncateExcerpt = (excerpt: string, max = 18): string => {
    const trimmed = excerpt.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max)}…`;
  };

  return (
    <div
      data-selection-action-menu
      style={style}
      className={`
        min-w-[10rem] max-w-[14rem] overflow-hidden rounded-xl
        border border-editor-border
        shadow-lg shadow-black/10 dark:shadow-black/30
        backdrop-blur-sm
        ${className}
      `.trim()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-end border-b border-editor-border px-1.5 py-1">
        <button
          type="button"
          className="rounded p-1 text-editor-muted hover:bg-editor-border/60 hover:text-editor-text transition-colors"
          title={t('common.close')}
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        type="button"
        className={itemClassName}
        title={t('editor.copySelection')}
        onClick={onCopy}
      >
        <Clipboard className="w-4 h-4 shrink-0 text-editor-muted" />
        <span>{t('editor.copySelection')}</span>
      </button>

      <button
        type="button"
        className={`${itemClassName} border-t border-editor-border`}
        title={t('editor.addToChat')}
        onClick={onAddToChat}
      >
        <MessagesSquare className="w-4 h-4 shrink-0 text-primary-500" />
        <span>{t('editor.addToChatLabel')}</span>
      </button>

      {hasExisting ? (
        existingComments.slice(0, 3).map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`${itemClassName} border-t border-editor-border`}
            title={t('comment.viewButton')}
            onClick={() => onViewComment(item.id)}
          >
            <Eye className="w-4 h-4 shrink-0 text-amber-500" />
            <span className="truncate">
              {existingComments.length > 1
                ? t('comment.viewWithExcerpt', { excerpt: truncateExcerpt(item.excerpt) })
                : t('comment.viewButton')}
            </span>
            {index === 2 && existingComments.length > 3 && (
              <span className="ml-auto shrink-0 text-[10px] text-editor-muted">
                +{existingComments.length - 3}
              </span>
            )}
          </button>
        ))
      ) : (
        <button
          type="button"
          className={`${itemClassName} border-t border-editor-border`}
          title={t('comment.addButton')}
          onClick={onAddComment}
        >
          <NotebookPen className="w-4 h-4 shrink-0 text-amber-500" />
          <span>{t('comment.addButton')}</span>
        </button>
      )}
    </div>
  );
}

/** 메뉴 높이 추정값 — 코멘트 popover 위치 보정용 */
export function getSelectionActionMenuHeight(existingCommentCount = 0): number {
  const commentItems = existingCommentCount > 0
    ? Math.min(existingCommentCount, 3)
    : 1;
  return CLOSE_HEADER_HEIGHT + (2 + commentItems) * ITEM_HEIGHT + 8;
}
