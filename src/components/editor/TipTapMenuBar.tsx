import { Editor, useEditorState } from '@tiptap/react';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import {
  Heading,
  Pilcrow,
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
  MoreHorizontal,
  Table as TableIcon,
  Rows3,
  Columns3,
  Trash2,
  Eraser,
} from 'lucide-react';
import { hasAppliedChangeHighlights } from '@/editor/extensions/AppliedChangeHighlight';

interface TipTapMenuBarProps {
  editor: Editor | null;
  panelType: 'source' | 'target';
}

const ICON_SIZE = 13;

// 지우개 버튼은 적용 표시가 있을 때만 나타나 처음 보는 사용자가 존재를 모르기 쉽다.
// 적용 표시가 처음 생길 때 **딱 한 번** 팝업으로 알려준다.
// (토스트는 상단 스트립과 겹쳐 가독성이 나빴다 — 네이티브 다이얼로그 사용)
//
// "본 적 있음"은 uiStore에 영속한다. 모듈 변수로 두면 JS 컨텍스트가 새로 뜰 때마다
// 초기화되어 앱 재시작마다(데브에서는 Vite full reload마다) 다시 뜬다.
// 같은 팝업이 두 메뉴바(Source/Target)에서 겹쳐 뜨지 않도록, 스토어에 쓰기 전까지의
// 짧은 틈은 모듈 변수로 막는다 — set은 비동기가 아니지만 두 인스턴스의 effect가
// 같은 렌더 커밋에서 연달아 도는 경우를 방어한다.
let appliedChangesHintDispatched = false;

/**
 * 오버플로(⋯) 메뉴 항목. 자주 쓰지 않는 서식이라 상시 노출에서 내렸다.
 * 메뉴바가 패널 폭에 밀려 두 줄로 접히던(flex-wrap) 원인이 이 항목들이었다.
 */
const OVERFLOW_MARKS: ReadonlyArray<{
  key: string;
  mark: string;
  Icon: typeof Code;
  run: (chain: ReturnType<Editor['chain']>) => void;
}> = [
  { key: 'inlineCode', mark: 'code', Icon: Code, run: (c) => { c.toggleCode().run(); } },
  { key: 'subscript', mark: 'subscript', Icon: Subscript, run: (c) => { c.toggleSubscript().run(); } },
  { key: 'superscript', mark: 'superscript', Icon: Superscript, run: (c) => { c.toggleSuperscript().run(); } },
  { key: 'blockquote', mark: 'blockquote', Icon: Quote, run: (c) => { c.toggleBlockquote().run(); } },
];

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
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);

  const hintSeen = useUIStore((s) => s.appliedChangesHintSeen);
  const markAppliedChangesHintSeen = useUIStore((s) => s.markAppliedChangesHintSeen);

  // 표 메뉴는 커서가 표 안에 있을 때만 쓸 수 있다. isActive는 렌더 시점 값이라
  // 선택이 바뀌어도 갱신되지 않으므로, 이 값만 구독해 다시 그린다.
  const inTable = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.isActive('table') ?? false,
  }) ?? false;

  const hasAppliedChanges = useEditorState({
    editor,
    selector: ({ editor: e }) => (
      panelType === 'target' && e ? hasAppliedChangeHighlights(e.state.doc) : false
    ),
  }) ?? false;

  useEffect(() => {
    if (!hasAppliedChanges || hintSeen || appliedChangesHintDispatched) return;
    appliedChangesHintDispatched = true;
    markAppliedChangesHintSeen();
    // 웹 모드(브라우저 E2E)에는 네이티브 다이얼로그가 없다 — 힌트는 조용히 생략.
    void message(
      t(
        'editor.menuBar.appliedChangesHint',
        'AI가 적용한 부분이 강조 표시됩니다. 문장을 수정하면 자동으로 사라지고, 메뉴 바의 지우개 버튼으로 한꺼번에 지울 수 있어요.',
      ),
      { title: t('editor.menuBar.appliedChangesHintTitle', '적용 표시 안내') },
    ).catch(() => {});
  }, [hasAppliedChanges, hintSeen, markAppliedChangesHintSeen, t]);

  // 표 명령은 모두 같은 형태다(포커스 → 명령 → 메뉴 닫기).
  const runTableCommand = useCallback(
    (run: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      run(editor.chain().focus());
      setTableMenuOpen(false);
    },
    [editor],
  );

  // 오버플로 항목도 같은 형태다(포커스 → 토글 → 메뉴 닫기).
  const runOverflowCommand = useCallback(
    (run: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      run(editor.chain().focus());
      setOverflowMenuOpen(false);
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

  const setParagraph = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().setParagraph().run();
    setHeadingMenuOpen(false);
  }, [editor]);

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
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-editor-hairline bg-editor-bg">
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
              className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded shadow-lg z-50 min-w-[112px]"
              role="menu"
              aria-label={t('editor.menuBar.heading')}
            >
              <button
                type="button"
                role="menuitem"
                onClick={setParagraph}
                className={`
                  flex items-center gap-1 w-full px-3 py-1.5 text-sm hover:bg-editor-bg transition-colors
                  ${isActive('paragraph') ? 'bg-editor-bg font-medium' : ''}
                `}
                aria-label={t('editor.menuBar.paragraph')}
              >
                <Pilcrow size={13} />
                <span>{t('editor.menuBar.paragraph')}</span>
              </button>
              <div className="h-px bg-editor-border" />
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
                    ${dividerBefore ? 'border-t border-editor-hairline' : ''}
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

      {/* 더 보기 — 드물게 쓰는 서식과 보기 설정을 여기에 모은다.
          툴바가 좁은 패널에서 두 줄로 접히던 것을 한 줄로 유지하기 위한 것이고,
          없어진 기능은 하나도 없다. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOverflowMenuOpen(!overflowMenuOpen)}
          className={`${btnBase} ${overflowMenuOpen ? btnActive : ''}`}
          title={t('editor.menuBar.more')}
          aria-label={t('editor.menuBar.more')}
          aria-haspopup="menu"
          aria-expanded={overflowMenuOpen}
          data-testid={`editor-menubar-more-${panelType}`}
        >
          <MoreHorizontal size={ICON_SIZE} />
        </button>
        {overflowMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOverflowMenuOpen(false)}
            />
            <div
              className="absolute top-full right-0 mt-1 bg-editor-surface border border-editor-border rounded-md shadow-overlay z-50 min-w-[212px] py-1"
              role="menu"
              aria-label={t('editor.menuBar.more')}
            >
              {OVERFLOW_MARKS.map(({ key, mark, Icon, run }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  aria-pressed={isActive(mark)}
                  onClick={() => runOverflowCommand(run)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors ${isActive(mark) ? 'text-primary-500' : ''}`}
                >
                  <Icon size={13} />
                  <span>{t(`editor.menuBar.${key}`)}</span>
                </button>
              ))}

              <div className="border-t border-editor-hairline my-1" />

              {/* 글자 크기·줄 간격은 문서 서식이 아니라 이 패널의 보기 설정이라
                  본 줄에서 내려도 잃는 것이 없다. 여기서는 메뉴를 닫지 않는다 —
                  연속으로 눌러 맞추는 컨트롤이기 때문. */}
              <div className="flex items-center justify-between gap-2 px-3 py-1 text-sm">
                <span>{t('editor.menuBar.fontSize')}</span>
                <span className="flex items-center gap-0.5 shrink-0">
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
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 py-1 text-sm">
                <span>{t('editor.menuBar.lineHeight')}</span>
                <span className="flex items-center gap-0.5 shrink-0">
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
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {hasAppliedChanges && (
        <>
          <div className="w-px h-5 bg-editor-border mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().clearAppliedChangeHighlights().run()}
            className={`${btnBase} text-diff-insertion`}
            title={t('editor.menuBar.clearAppliedChanges')}
            aria-label={t('editor.menuBar.clearAppliedChanges')}
          >
            <Eraser size={ICON_SIZE} />
          </button>
        </>
      )}
    </div>
  );
}
