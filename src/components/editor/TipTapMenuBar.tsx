import { Editor } from '@tiptap/react';
import { useCallback, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import {
  Heading,
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Minus,
  Plus,
  MoveVertical,
} from 'lucide-react';

interface TipTapMenuBarProps {
  editor: Editor | null;
  panelType: 'source' | 'target';
}

const ICON_SIZE = 16;

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

  const btnBase = 'p-1.5 rounded hover:bg-editor-surface transition-colors';
  const btnActive = 'bg-editor-surface';

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-editor-border bg-editor-bg flex-wrap">
      {/* 헤딩 메뉴 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setHeadingMenuOpen(!headingMenuOpen)}
          className={`${btnBase} ${isActive('heading') ? btnActive : ''}`}
          title="헤딩"
          aria-label="헤딩"
        >
          <Heading size={ICON_SIZE} />
        </button>
        {headingMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setHeadingMenuOpen(false)}
            />
            <div className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded shadow-lg z-50 min-w-[48px]">
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setHeading(level as 1 | 2 | 3 | 4 | 5 | 6)}
                  className={`
                    flex items-center gap-1 w-full px-3 py-1.5 text-sm hover:bg-editor-bg transition-colors
                    ${isActive('heading', { level }) ? 'bg-editor-bg font-medium' : ''}
                  `}
                >
                  <Heading size={14} />
                  <span>{level}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 텍스트 스타일 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`${btnBase} ${isActive('bold') ? btnActive : ''}`}
        title="볼드 (Cmd+B)"
        aria-label="볼드"
      >
        <Bold size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${btnBase} ${isActive('italic') ? btnActive : ''}`}
        title="이탤릭 (Cmd+I)"
        aria-label="이탤릭"
      >
        <Italic size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`${btnBase} ${isActive('strike') ? btnActive : ''}`}
        title="취소선"
        aria-label="취소선"
      >
        <Strikethrough size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`${btnBase} ${isActive('code') ? btnActive : ''}`}
        title="인라인 코드 (Cmd+E)"
        aria-label="인라인 코드"
      >
        <Code size={ICON_SIZE} />
      </button>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 리스트 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`${btnBase} ${isActive('bulletList') ? btnActive : ''}`}
        title="불릿 리스트"
        aria-label="불릿 리스트"
      >
        <List size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`${btnBase} ${isActive('orderedList') ? btnActive : ''}`}
        title="번호 리스트"
        aria-label="번호 리스트"
      >
        <ListOrdered size={ICON_SIZE} />
      </button>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 인용 블록 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`${btnBase} ${isActive('blockquote') ? btnActive : ''}`}
        title="인용 블록"
        aria-label="인용 블록"
      >
        <Quote size={ICON_SIZE} />
      </button>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 폰트 크기 조정 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => adjustFontSize(-1)}
          className={btnBase}
          title="폰트 크기 -1px"
          aria-label="폰트 크기 줄이기"
        >
          <div className="flex items-center">
            <span className="text-xs font-medium">A</span>
            <Minus size={12} />
          </div>
        </button>
        <span className="text-xs text-editor-muted w-7 text-center tabular-nums">{fontSize}</span>
        <button
          type="button"
          onClick={() => adjustFontSize(1)}
          className={btnBase}
          title="폰트 크기 +1px"
          aria-label="폰트 크기 늘리기"
        >
          <div className="flex items-center">
            <span className="text-xs font-medium">A</span>
            <Plus size={12} />
          </div>
        </button>
      </div>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 줄 높이 조정 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => adjustLineHeight(-0.1)}
          className={btnBase}
          title="줄 높이 -0.1"
          aria-label="줄 높이 줄이기"
        >
          <div className="flex items-center">
            <MoveVertical size={14} />
            <Minus size={12} />
          </div>
        </button>
        <span className="text-xs text-editor-muted w-7 text-center tabular-nums">{lineHeight.toFixed(1)}</span>
        <button
          type="button"
          onClick={() => adjustLineHeight(0.1)}
          className={btnBase}
          title="줄 높이 +0.1"
          aria-label="줄 높이 늘리기"
        >
          <div className="flex items-center">
            <MoveVertical size={14} />
            <Plus size={12} />
          </div>
        </button>
      </div>
    </div>
  );
}
