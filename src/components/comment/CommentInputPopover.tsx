import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CommentInputPopoverProps {
  /** fixed 위치 좌표 */
  top: number;
  left: number;
  /** 마킹 대상 인용(미리보기용) */
  excerpt: string;
  /** 줌 보정(에디터 zoom 역수) */
  zoom?: number;
  onSave: (comment: string) => void;
  onCancel: () => void;
}

/**
 * 인라인 코멘트 입력 popover.
 * 작은 1–2줄 입력 + 저장/취소. AddToChat 버블과 동일한 좌표 체계(fixed)를 사용한다.
 */
export function CommentInputPopover({
  top,
  left,
  excerpt,
  zoom = 1,
  onSave,
  onCancel,
}: CommentInputPopoverProps): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 81,
        zoom,
        width: 280,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="
        rounded-lg p-2
        bg-editor-surface text-editor-text
        border border-editor-border
        shadow-lg shadow-black/10 dark:shadow-black/30
      "
    >
      <div className="mb-1.5 text-xs text-editor-muted truncate" title={excerpt}>
        “{excerpt}”
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
          }
        }}
        rows={2}
        placeholder={t('comment.inputPlaceholder', '코멘트를 입력하세요…')}
        className="
          w-full resize-none rounded-md px-2 py-1.5 text-sm
          bg-editor-bg text-editor-text
          border border-editor-border
          focus:outline-none focus:ring-1 focus:ring-blue-500
        "
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
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
    </div>
  );
}
