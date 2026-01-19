import { Editor } from '@tiptap/react';
import { useCallback, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';

interface TipTapMenuBarProps {
  editor: Editor | null;
  panelType: 'source' | 'target';
}

/**
 * TipTap 에디터 포맷팅 메뉴바
 * Notion 스타일의 리치 텍스트 포맷팅 도구
 */
export function TipTapMenuBar({ editor, panelType }: TipTapMenuBarProps): JSX.Element | null {
  // Source/Target 패널별 독립 폰트 설정
  const sourceFontSize = useUIStore((s) => s.sourceFontSize);
  const sourceLineHeight = useUIStore((s) => s.sourceLineHeight);
  const targetFontSize = useUIStore((s) => s.targetFontSize);
  const targetLineHeight = useUIStore((s) => s.targetLineHeight);
  const adjustSourceFontSize = useUIStore((s) => s.adjustSourceFontSize);
  const adjustSourceLineHeight = useUIStore((s) => s.adjustSourceLineHeight);
  const adjustTargetFontSize = useUIStore((s) => s.adjustTargetFontSize);
  const adjustTargetLineHeight = useUIStore((s) => s.adjustTargetLineHeight);

  // 현재 패널에 맞는 값과 함수 선택
  const fontSize = panelType === 'source' ? sourceFontSize : targetFontSize;
  const lineHeight = panelType === 'source' ? sourceLineHeight : targetLineHeight;
  const adjustFontSize = panelType === 'source' ? adjustSourceFontSize : adjustTargetFontSize;
  const adjustLineHeight = panelType === 'source' ? adjustSourceLineHeight : adjustTargetLineHeight;

  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);

  const setHeading = useCallback(
    (level: 1 | 2 | 3 | 4 | 5 | 6) => {
      if (!editor) return;
      editor.chain().focus().toggleHeading({ level }).run();
      setHeadingMenuOpen(false);
    },
    [editor],
  );

  const isActive = useCallback(
    (name: string, options?: Record<string, unknown>) => {
      if (!editor) return false;
      return editor.isActive(name, options);
    },
    [editor],
  );

  if (!editor) return null;

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

      {/* 구분선 */}
      <div className="w-px h-4 bg-editor-border mx-1" />

      {/* 폰트 크기 조정 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => adjustFontSize(-1)}
          className="px-1.5 py-1 text-xs rounded hover:bg-editor-surface transition-colors"
          title="폰트 크기 -1px"
        >
          A-
        </button>
        <span className="text-xs text-editor-muted w-8 text-center">{fontSize}</span>
        <button
          type="button"
          onClick={() => adjustFontSize(1)}
          className="px-1.5 py-1 text-xs rounded hover:bg-editor-surface transition-colors"
          title="폰트 크기 +1px"
        >
          A+
        </button>
      </div>

      {/* 구분선 */}
      <div className="w-px h-4 bg-editor-border mx-1" />

      {/* 줄 높이 조정 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => adjustLineHeight(-0.1)}
          className="px-1.5 py-1 text-xs rounded hover:bg-editor-surface transition-colors"
          title="줄 높이 -0.1"
        >
          ↕-
        </button>
        <span className="text-xs text-editor-muted w-8 text-center">{lineHeight.toFixed(1)}</span>
        <button
          type="button"
          onClick={() => adjustLineHeight(0.1)}
          className="px-1.5 py-1 text-xs rounded hover:bg-editor-surface transition-colors"
          title="줄 높이 +0.1"
        >
          ↕+
        </button>
      </div>
    </div>
  );
}

