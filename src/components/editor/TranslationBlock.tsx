import { memo, useEffect } from 'react';
import { EditorContent } from '@tiptap/react';
import type { EditorBlock } from '@/types';
import { useBlockEditor } from '@/hooks/useBlockEditor';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { refreshEditorHighlight } from '@/editor/extensions/ReviewHighlight';

interface TranslationBlockProps {
  block: EditorBlock;
  readOnly?: boolean;
  onChange?: (content: string) => void;
}

/**
 * 번역 블록 컴포넌트
 * TipTap 에디터를 사용한 개별 블록 렌더링
 */
export const TranslationBlock = memo(function TranslationBlock({
  block,
  readOnly = false,
  onChange,
}: TranslationBlockProps): JSX.Element {
  const hasPendingDiff = useProjectStore((s) => s.hasPendingDiff(block.id));
  const acceptDiff = useProjectStore((s) => s.acceptDiff);
  const rejectDiff = useProjectStore((s) => s.rejectDiff);

  const editorOptions = {
    content: block.content,
    readOnly,
    blockId: block.id,
    ...(onChange ? { onChange } : {}),
  };

  const { editor, isFocused } = useBlockEditor(editorOptions);

  // 검수 하이라이트 동기화
  const highlightNonce = useReviewStore((s) => s.highlightNonce);

  useEffect(() => {
    if (editor && highlightNonce > 0) {
      refreshEditorHighlight(editor);
    }
  }, [editor, highlightNonce]);

  return (
    <div
      className={`
        editor-block
        ${isFocused ? 'border-l-primary-500 bg-editor-surface' : ''}
        ${readOnly ? 'cursor-default' : 'cursor-text'}
      `}
      data-block-id={block.id}
      data-block-type={block.type}
    >
      {/* Diff Accept/Reject (pending 상태에서만) */}
      {!readOnly && hasPendingDiff && (
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            onClick={() => acceptDiff(block.id)}
            title="Accept (Cmd+Y)"
          >
            Accept
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-editor-bg text-editor-text hover:bg-editor-border transition-colors"
            onClick={() => rejectDiff(block.id)}
            title="Reject (Cmd+N)"
          >
            Reject
          </button>
        </div>
      )}

      {/* TipTap Editor */}
      {editor ? (
        <EditorContent
          editor={editor}
          className={`
            min-h-[1.5em] text-editor leading-relaxed
            ${readOnly ? 'text-editor-muted' : 'text-editor-text'}
          `}
        />
      ) : (
        <div className="min-h-[1.5em]" />
      )}

      {/* 메타데이터 표시 (태그가 있는 경우) */}
      {block.metadata.tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {block.metadata.tags.map((tag, index) => (
            <span key={`${tag}-${index}`} className="ghost-chip">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

