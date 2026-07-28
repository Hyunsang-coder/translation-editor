import { Clipboard, Eye, Languages, MessagesSquare, NotebookPen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SelectionPanel } from '@/types';
import { shortcutLabel } from '@/utils/platform';

export interface SelectionExistingComment {
  id: string;
  excerpt: string;
}

interface SelectionActionMenuProps {
  panel?: SelectionPanel;
  existingComments?: SelectionExistingComment[];
  onCopy: () => void;
  onAddToChat: () => void;
  onRetranslateSelection?: () => void;
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
  panel = 'source',
  existingComments = [],
  onCopy,
  onAddToChat,
  onRetranslateSelection,
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
      data-testid={`selection-action-menu-${panel}`}
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
        data-testid="selection-action-copy"
        className={itemClassName}
        title={t('editor.copySelection')}
        onClick={onCopy}
      >
        <Clipboard className="w-4 h-4 shrink-0 text-editor-muted" />
        <span>{t('editor.copySelection')}</span>
      </button>

      <button
        type="button"
        data-testid="selection-action-add-chat"
        className={`${itemClassName} border-t border-editor-border`}
        title={t('editor.addToChat')}
        onClick={onAddToChat}
      >
        <MessagesSquare className="w-4 h-4 shrink-0 text-primary-500" />
        <span>{t('editor.addToChatLabel')}</span>
      </button>

      {panel === 'target' && onRetranslateSelection && (
        <button
          type="button"
          data-testid="selection-action-retranslate"
          className={`${itemClassName} border-t border-editor-border`}
          title={t('editor.retranslateSelection')}
          onClick={onRetranslateSelection}
        >
          <Languages className="w-4 h-4 shrink-0 text-violet-500" />
          <span>{t('editor.retranslateSelection')}</span>
        </button>
      )}

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

/** 인라인 선택 툴바 높이(px) — 선택 영역 위 배치 계산에 쓰인다 */
export const SELECTION_INLINE_TOOLBAR_HEIGHT = 34;

interface SelectionInlineToolbarProps {
  panel?: SelectionPanel;
  onCopy: () => void;
  onAddToChat: () => void;
  onRetranslateSelection?: () => void;
  onAddComment: () => void;
  style?: React.CSSProperties;
}

/**
 * 텍스트를 선택하면 선택 영역 위에 자동으로 뜨는 가로 액션 바.
 *
 * 우클릭 메뉴(`SelectionActionMenu`)는 그대로 남는다. 이 바는 같은 액션을
 * 발견 가능하게 만드는 것이 목적이라 항목을 4개로 줄였다(기존 코멘트 보기는
 * 우클릭 메뉴에만 있다).
 */
export function SelectionInlineToolbar({
  panel = 'source',
  onCopy,
  onAddToChat,
  onRetranslateSelection,
  onAddComment,
  style,
}: SelectionInlineToolbarProps): JSX.Element {
  const { t } = useTranslation();

  const itemClassName = 'h-[34px] px-3 flex items-center gap-1.5 text-xs font-semibold transition-colors';

  return (
    <div
      data-selection-action-menu
      data-testid={`selection-inline-toolbar-${panel}`}
      style={style}
      className="flex items-stretch overflow-hidden rounded-md border border-editor-text bg-editor-surface shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {panel === 'target' && onRetranslateSelection && (
        <button
          type="button"
          data-testid="selection-inline-retranslate"
          className={`${itemClassName} bg-primary-500 text-white hover:bg-primary-600`}
          title={t('editor.retranslateSelection')}
          onClick={onRetranslateSelection}
        >
          <Languages className="w-3.5 h-3.5 shrink-0" />
          <span>{t('editor.retranslateSelection')}</span>
        </button>
      )}

      <button
        type="button"
        data-testid="selection-inline-add-chat"
        className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-border first:border-l-0`}
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
        className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-border`}
        title={t('comment.addButton')}
        onClick={onAddComment}
      >
        <NotebookPen className="w-3.5 h-3.5 shrink-0" />
        <span>{t('comment.addButton')}</span>
      </button>

      <button
        type="button"
        data-testid="selection-inline-copy"
        className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-border`}
        title={t('editor.copySelection')}
        onClick={onCopy}
      >
        <Clipboard className="w-3.5 h-3.5 shrink-0" />
        <span>{t('editor.copySelection')}</span>
      </button>
    </div>
  );
}

/** 메뉴 높이 추정값 — 코멘트 popover 위치 보정용 */
export function getSelectionActionMenuHeight(
  existingCommentCount = 0,
  panel: SelectionPanel = 'source',
): number {
  const commentItems = existingCommentCount > 0
    ? Math.min(existingCommentCount, 3)
    : 1;
  const retranslateItems = panel === 'target' ? 1 : 0;
  return CLOSE_HEADER_HEIGHT + (2 + retranslateItems + commentItems) * ITEM_HEIGHT + 8;
}
