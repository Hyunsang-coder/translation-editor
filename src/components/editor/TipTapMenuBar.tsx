import { Editor } from '@tiptap/react';
import { useCallback, useState } from 'react';

interface TipTapMenuBarProps {
  editor: Editor | null;
}

/**
 * TipTap 에디터 포맷팅 메뉴바
 * Notion 스타일의 리치 텍스트 포맷팅 도구
 */
export function TipTapMenuBar({ editor }: TipTapMenuBarProps): JSX.Element | null {
  if (!editor) return null;

  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);

  const setHeading = useCallback(
    (level: 1 | 2 | 3 | 4 | 5 | 6) => {
      editor.chain().focus().toggleHeading({ level }).run();
      setHeadingMenuOpen(false);
    },
    [editor],
  );

  const isActive = useCallback(
    (name: string, options?: Record<string, unknown>) => {
      return editor.isActive(name, options);
    },
    [editor],
  );

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-editor-border bg-editor-bg flex-wrap">
      {/* 헤딩 메뉴 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setHeadingMenuOpen(!headingMenuOpen)}
          className={`
            px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors
            ${isActive('heading') ? 'bg-editor-surface font-medium' : ''}
          `}
          title="헤딩"
        >
          H
        </button>
        {headingMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setHeadingMenuOpen(false)}
            />
            <div className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded shadow-lg z-50">
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setHeading(level as 1 | 2 | 3 | 4 | 5 | 6)}
                  className={`
                    block w-full text-left px-3 py-1.5 text-xs hover:bg-editor-bg transition-colors
                    ${isActive('heading', { level }) ? 'bg-editor-bg font-medium' : ''}
                  `}
                >
                  H{level}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 구분선 */}
      <div className="w-px h-4 bg-editor-border mx-1" />

      {/* 텍스트 스타일 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors font-bold
          ${isActive('bold') ? 'bg-editor-surface' : ''}
        `}
        title="볼드 (Cmd+B)"
      >
        B
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors italic
          ${isActive('italic') ? 'bg-editor-surface' : ''}
        `}
        title="이탤릭 (Cmd+I)"
      >
        I
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors line-through
          ${isActive('strike') ? 'bg-editor-surface' : ''}
        `}
        title="취소선"
      >
        S
      </button>

      {/* 구분선 */}
      <div className="w-px h-4 bg-editor-border mx-1" />

      {/* 리스트 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors
          ${isActive('bulletList') ? 'bg-editor-surface' : ''}
        `}
        title="불릿 리스트"
      >
        •
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors
          ${isActive('orderedList') ? 'bg-editor-surface' : ''}
        `}
        title="번호 리스트"
      >
        1.
      </button>

      {/* 구분선 */}
      <div className="w-px h-4 bg-editor-border mx-1" />

      {/* 인용 블록 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors
          ${isActive('blockquote') ? 'bg-editor-surface' : ''}
        `}
        title="인용 블록"
      >
        "
      </button>

      {/* 링크 */}
      <button
        type="button"
        onClick={() => {
          const url = window.prompt('URL을 입력하세요:');
          if (url) {
            editor.chain().focus().setLink({ href: url }).run();
          }
        }}
        className={`
          px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors
          ${isActive('link') ? 'bg-editor-surface' : ''}
        `}
        title="링크 추가"
      >
        🔗
      </button>
      {isActive('link') && (
        <button
          type="button"
          onClick={() => editor.chain().focus().unsetLink().run()}
          className="px-2 py-1 text-xs rounded hover:bg-editor-surface transition-colors"
          title="링크 제거"
        >
          ✕
        </button>
      )}
    </div>
  );
}

