import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { UserComment } from '@/stores/commentStore';

interface CommentDetailPopoverProps {
  top: number;
  left: number;
  comment: UserComment;
  zoom?: number;
  onSave: (text: string) => void;
  onToggleResolve: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * 인라인 코멘트 상세 popover — 마크 클릭 또는 선택 메뉴에서 연다.
 * 보기/수정, 해결 토글, 삭제를 에디터 맥락에서 처리한다.
 */
export function CommentDetailPopover({
  top,
  left,
  comment,
  zoom = 1,
  onSave,
  onToggleResolve,
  onDelete,
  onCancel,
}: CommentDetailPopoverProps): JSX.Element {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(comment.comment);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setValue(comment.comment);
    setEditing(false);
  }, [comment.id, comment.comment]);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onCancel]);

  const handleSave = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setEditing(false);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 82,
        zoom,
        width: 300,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="
        rounded-lg p-2.5
        bg-editor-surface text-editor-text
        border border-editor-border
        shadow-lg shadow-black/10 dark:shadow-black/30
      "
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 truncate text-xs italic text-editor-muted" title={comment.excerpt}>
            “{comment.excerpt}”
          </div>
          {comment.resolved && !editing && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 bg-emerald-500/10">
              {t('comment.resolvedBadge', '해결됨')}
            </span>
          )}
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded p-1 text-editor-muted hover:bg-editor-bg hover:text-editor-text"
            title={t('common.edit', '편집')}
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setValue(comment.comment);
                setEditing(false);
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSave();
              }
            }}
            rows={3}
            className="
              w-full resize-none rounded-md px-2 py-1.5 text-sm
              bg-editor-bg text-editor-text
              border border-editor-border
              focus:outline-none focus:ring-1 focus:ring-blue-500
            "
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setValue(comment.comment);
                setEditing(false);
              }}
              className="px-2.5 py-1 text-xs rounded-md text-editor-muted hover:bg-editor-bg"
            >
              {t('common.cancel', '취소')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!value.trim()}
              className="
                px-2.5 py-1 text-xs rounded-md font-medium
                bg-blue-600 text-white
                hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              {t('common.save', '저장')}
            </button>
          </div>
        </>
      ) : (
        <p className={`text-sm whitespace-pre-wrap break-words ${comment.resolved ? 'text-editor-muted line-through' : 'text-editor-text'}`}>
          {comment.comment}
        </p>
      )}

      {!editing && (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-editor-border pt-2">
          <button
            type="button"
            onClick={onToggleResolve}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              comment.resolved
                ? 'text-editor-muted hover:bg-editor-bg'
                : 'text-emerald-600 hover:bg-emerald-500/10'
            }`}
            title={
              comment.resolved
                ? t('comment.unresolve', '미해결로 표시')
                : t('comment.resolve', '해결로 표시')
            }
          >
            <Check size={14} />
            {comment.resolved
              ? t('comment.unresolve', '미해결로 표시')
              : t('comment.resolve', '해결로 표시')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
            title={t('common.delete', '삭제')}
          >
            <Trash2 size={14} />
            {t('common.delete', '삭제')}
          </button>
        </div>
      )}
    </div>
  );
}
