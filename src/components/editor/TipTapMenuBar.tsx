import { Editor, useEditorState } from '@tiptap/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import {
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Code,
  Subscript,
  Superscript,
  List,
  ListOrdered,
  Quote,
  Minus,
  Plus,
  MoveVertical,
  Table as TableIcon,
  Rows3,
  Columns3,
  Trash2,
} from 'lucide-react';

interface TipTapMenuBarProps {
  editor: Editor | null;
  panelType: 'source' | 'target';
}

const ICON_SIZE = 13;

/**
 * 표 행/열 편집 항목. i18n 키는 `editor.menuBar.<key>`.
 * 셀 병합/분할은 의도적으로 제외 — 병합 셀은 번역 직렬화(raw HTML) 쪽 처리가 따로 필요하다.
 */
const TABLE_ACTIONS: ReadonlyArray<{
  key: string;
  Icon: typeof Rows3;
  dividerBefore?: boolean;
  run: (chain: ReturnType<Editor['chain']>) => void;
}> = [
  { key: 'tableAddRowBefore', Icon: Rows3, run: (c) => { c.addRowBefore().run(); } },
  { key: 'tableAddRowAfter', Icon: Rows3, run: (c) => { c.addRowAfter().run(); } },
  { key: 'tableDeleteRow', Icon: Trash2, run: (c) => { c.deleteRow().run(); } },
  { key: 'tableAddColumnBefore', Icon: Columns3, dividerBefore: true, run: (c) => { c.addColumnBefore().run(); } },
  { key: 'tableAddColumnAfter', Icon: Columns3, run: (c) => { c.addColumnAfter().run(); } },
  { key: 'tableDeleteColumn', Icon: Trash2, run: (c) => { c.deleteColumn().run(); } },
];

/**
 * TipTap 에디터 포맷팅 메뉴바
 * Notion 스타일의 리치 텍스트 포맷팅 도구
 */
export function TipTapMenuBar({ editor, panelType }: TipTapMenuBarProps): JSX.Element | null {
  const { t } = useTranslation();

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
  const [tableMenuOpen, setTableMenuOpen] = useState(false);

  // 표 메뉴는 커서가 표 안에 있을 때만 쓸 수 있다. isActive는 렌더 시점 값이라
  // 선택이 바뀌어도 갱신되지 않으므로, 이 값만 구독해 다시 그린다.
  const inTable = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.isActive('table') ?? false,
  }) ?? false;

  // 표 명령은 모두 같은 형태다(포커스 → 명령 → 메뉴 닫기).
  const runTableCommand = useCallback(
    (run: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      run(editor.chain().focus());
      setTableMenuOpen(false);
    },
    [editor],
  );

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
          title={t('editor.menuBar.heading')}
          aria-label={t('editor.menuBar.heading')}
          aria-haspopup="menu"
          aria-expanded={headingMenuOpen}
        >
          <Heading size={ICON_SIZE} />
        </button>
        {headingMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setHeadingMenuOpen(false)}
            />
            <div
              className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded shadow-lg z-50 min-w-[48px]"
              role="menu"
              aria-label={t('editor.menuBar.heading')}
            >
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <button
                  key={level}
                  type="button"
                  role="menuitem"
                  onClick={() => setHeading(level as 1 | 2 | 3 | 4 | 5 | 6)}
                  className={`
                    flex items-center gap-1 w-full px-3 py-1.5 text-sm hover:bg-editor-bg transition-colors
                    ${isActive('heading', { level }) ? 'bg-editor-bg font-medium' : ''}
                  `}
                  aria-label={t('editor.menuBar.headingLevel', { level })}
                >
                  <Heading size={13} />
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
        title={t('editor.menuBar.boldTitle')}
        aria-label={t('editor.menuBar.bold')}
      >
        <Bold size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${btnBase} ${isActive('italic') ? btnActive : ''}`}
        title={t('editor.menuBar.italicTitle')}
        aria-label={t('editor.menuBar.italic')}
      >
        <Italic size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`${btnBase} ${isActive('underline') ? btnActive : ''}`}
        title={t('editor.menuBar.underlineTitle')}
        aria-label={t('editor.menuBar.underline')}
      >
        <Underline size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`${btnBase} ${isActive('strike') ? btnActive : ''}`}
        title={t('editor.menuBar.strikethrough')}
        aria-label={t('editor.menuBar.strikethrough')}
      >
        <Strikethrough size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={`${btnBase} ${isActive('highlight') ? btnActive : ''}`}
        title={t('editor.menuBar.highlightTitle')}
        aria-label={t('editor.menuBar.highlight')}
      >
        <Highlighter size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`${btnBase} ${isActive('code') ? btnActive : ''}`}
        title={t('editor.menuBar.inlineCodeTitle')}
        aria-label={t('editor.menuBar.inlineCode')}
      >
        <Code size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        className={`${btnBase} ${isActive('subscript') ? btnActive : ''}`}
        title={t('editor.menuBar.subscriptTitle')}
        aria-label={t('editor.menuBar.subscript')}
      >
        <Subscript size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        className={`${btnBase} ${isActive('superscript') ? btnActive : ''}`}
        title={t('editor.menuBar.superscriptTitle')}
        aria-label={t('editor.menuBar.superscript')}
      >
        <Superscript size={ICON_SIZE} />
      </button>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 리스트 */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`${btnBase} ${isActive('bulletList') ? btnActive : ''}`}
        title={t('editor.menuBar.bulletList')}
        aria-label={t('editor.menuBar.bulletList')}
      >
        <List size={ICON_SIZE} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`${btnBase} ${isActive('orderedList') ? btnActive : ''}`}
        title={t('editor.menuBar.orderedList')}
        aria-label={t('editor.menuBar.orderedList')}
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
        title={t('editor.menuBar.blockquote')}
        aria-label={t('editor.menuBar.blockquote')}
      >
        <Quote size={ICON_SIZE} />
      </button>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 표 행/열 편집 — 커서가 표 안에 있을 때만 활성화된다 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setTableMenuOpen(!tableMenuOpen)}
          disabled={!inTable}
          className={`${btnBase} ${tableMenuOpen ? btnActive : ''} disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent`}
          title={inTable ? t('editor.menuBar.table') : t('editor.menuBar.tableDisabledTitle')}
          aria-label={t('editor.menuBar.table')}
          aria-haspopup="menu"
          aria-expanded={tableMenuOpen}
        >
          <TableIcon size={ICON_SIZE} />
        </button>
        {tableMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setTableMenuOpen(false)}
            />
            <div
              className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded shadow-lg z-50 min-w-[150px] py-0.5"
              role="menu"
              aria-label={t('editor.menuBar.table')}
            >
              {TABLE_ACTIONS.map(({ key, Icon, dividerBefore, run }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  onClick={() => runTableCommand(run)}
                  className={`
                    flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors
                    ${dividerBefore ? 'border-t border-editor-border' : ''}
                  `}
                >
                  <Icon size={13} />
                  <span>{t(`editor.menuBar.${key}`)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 폰트 크기 조정 */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => adjustFontSize(-1)}
          className={btnBase}
          title={t('editor.menuBar.fontSizeDecreaseTitle')}
          aria-label={t('editor.menuBar.fontSizeDecrease')}
        >
          <div className="flex items-center">
            <span className="text-xs font-medium">A</span>
            <Minus size={10} />
          </div>
        </button>
        <span className="text-xs text-editor-muted w-7 text-center tabular-nums">{fontSize}</span>
        <button
          type="button"
          onClick={() => adjustFontSize(1)}
          className={btnBase}
          title={t('editor.menuBar.fontSizeIncreaseTitle')}
          aria-label={t('editor.menuBar.fontSizeIncrease')}
        >
          <div className="flex items-center">
            <span className="text-xs font-medium">A</span>
            <Plus size={10} />
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
          title={t('editor.menuBar.lineHeightDecreaseTitle')}
          aria-label={t('editor.menuBar.lineHeightDecrease')}
        >
          <div className="flex items-center">
            <MoveVertical size={13} />
            <Minus size={10} />
          </div>
        </button>
        <span className="text-xs text-editor-muted w-7 text-center tabular-nums">{lineHeight.toFixed(1)}</span>
        <button
          type="button"
          onClick={() => adjustLineHeight(0.1)}
          className={btnBase}
          title={t('editor.menuBar.lineHeightIncreaseTitle')}
          aria-label={t('editor.menuBar.lineHeightIncrease')}
        >
          <div className="flex items-center">
            <MoveVertical size={13} />
            <Plus size={10} />
          </div>
        </button>
      </div>
    </div>
  );
}
