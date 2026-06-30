import { Eye, MessagesSquare, StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SelectionExistingComment {
  id: string;
  excerpt: string;
}

interface SelectionActionMenuProps {
  existingComments?: SelectionExistingComment[];
  onAddToChat: () => void;
  onAddComment: () => void;
  onViewComment: (commentId: string) => void;
  style?: React.CSSProperties;
  className?: string;
}

const ITEM_HEIGHT = 38;

/**
 * 텍스트 선택 후 표시되는 세로 액션 메뉴 (채팅 추가 / 코멘트).
 */
export function SelectionActionMenu({
  existingComments = [],
  onAddToChat,
  onAddComment,
  onViewComment,
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
      <button
        type="button"
        className={itemClassName}
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
          <StickyNote className="w-4 h-4 shrink-0 text-amber-500" />
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
  return (1 + commentItems) * ITEM_HEIGHT + 8;
}
