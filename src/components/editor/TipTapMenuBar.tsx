import { Editor, useEditorState } from '@tiptap/react';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ListTodo,
  IndentDecrease,
  IndentIncrease,
  Link2,
  NotebookPen,
  Quote,
  Minus,
  Plus,
  MoveVertical,
  ALargeSmall,
  ChevronDown,
  Table as TableIcon,
  Rows3,
  Columns3,
  Trash2,
  Eraser,
  ChevronLeft,
  ChevronRight,
  Check,
} from 'lucide-react';
import {
  getAppliedChangeGroups,
  getAppliedChangeIdAtSelection,
} from '@/editor/extensions/AppliedChangeHighlight';

interface TipTapMenuBarProps {
  editor: Editor | null;
  panelType: 'source' | 'target';
  /** 메뉴바 코멘트 버튼 — EditorCanvasTipTap의 commentPopover를 연다. 없으면 버튼을 숨긴다. */
  onAddComment?: (() => void) | undefined;
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
 * Confluence식 단축키 칩. 메뉴 행 우측에 실바인딩을 표시한다.
 * 바인딩이 없는 항목(밑줄 등)은 칩을 달지 않는다 — 동작하지 않는 단축키를 안내하지 않기 위해.
 */
function Kbd({ label }: { label: string }): JSX.Element {
  return (
    <kbd className="ml-auto shrink-0 rounded bg-editor-bg px-1.5 py-0.5 text-[11px] text-editor-muted">
      {label}
    </kbd>
  );
}

/** 헤딩 드롭다운의 레벨별 미리보기 크기. Confluence처럼 실제 크기로 보여준다. */
const HEADING_PREVIEW_CLASS: Record<number, string> = {
  1: 'text-lg font-bold',
  2: 'text-base font-bold',
  3: 'text-[15px] font-bold',
  4: 'text-sm font-semibold',
  5: 'text-[13px] font-semibold',
  6: 'text-xs font-semibold',
};

/**
 * B(서식) 메뉴 항목. Confluence식 — B 스플릿 버튼의 드롭다운에 인라인 서식을 모은다.
 * shortcut은 node_modules의 실바인딩과 대조한 값이다. 바인딩이 없는 밑줄은 칩을 달지 않는다.
 */
const FORMAT_MARKS: ReadonlyArray<{
  key: string;
  mark: string;
  Icon: typeof Code;
  shortcut?: string;
  run: (chain: ReturnType<Editor['chain']>) => void;
}> = [
  { key: 'bold', mark: 'bold', Icon: Bold, shortcut: '⌘B', run: (c) => { c.toggleBold().run(); } },
  { key: 'italic', mark: 'italic', Icon: Italic, shortcut: '⌘I', run: (c) => { c.toggleItalic().run(); } },
  { key: 'underline', mark: 'underline', Icon: Underline, run: (c) => { c.toggleUnderline().run(); } },
  { key: 'strikethrough', mark: 'strike', Icon: Strikethrough, shortcut: '⌘⇧S', run: (c) => { c.toggleStrike().run(); } },
  { key: 'inlineCode', mark: 'code', Icon: Code, shortcut: '⌘E', run: (c) => { c.toggleCode().run(); } },
  { key: 'subscript', mark: 'subscript', Icon: Subscript, shortcut: '⌘,', run: (c) => { c.toggleSubscript().run(); } },
  { key: 'superscript', mark: 'superscript', Icon: Superscript, shortcut: '⌘.', run: (c) => { c.toggleSuperscript().run(); } },
  { key: 'highlight', mark: 'highlight', Icon: Highlighter, shortcut: '⌘⇧H', run: (c) => { c.toggleHighlight().run(); } },
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
export function TipTapMenuBar({ editor, panelType, onAddComment }: TipTapMenuBarProps): JSX.Element | null {
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
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const hintSeen = useUIStore((s) => s.appliedChangesHintSeen);
  const markAppliedChangesHintSeen = useUIStore((s) => s.markAppliedChangesHintSeen);

  // 표 메뉴는 커서가 표 안에 있을 때만 쓸 수 있다. isActive는 렌더 시점 값이라
  // 선택이 바뀌어도 갱신되지 않으므로, 이 값만 구독해 다시 그린다.
  const inTable = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.isActive('table') ?? false,
  }) ?? false;

  // 적용 표시 내비게이션 키 — "count|index|activeId" primitive 한 개로 구독한다.
  // 배열/Map을 selector에서 반환하면 매 트랜잭션 리렌더되므로 금지. groups는
  // 여기서 한 번만 순회하고, 상세 목록이 필요하면 클릭 핸들러에서 다시 계산한다.
  const appliedChangeNavKey = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (panelType !== 'target' || !e) return '0|-1|';
      const groups = getAppliedChangeGroups(e.state.doc);
      if (groups.length === 0) return '0|-1|';
      const activeId = getAppliedChangeIdAtSelection(e.state) ?? '';
      const index = activeId ? groups.findIndex((g) => g.id === activeId) : -1;
      return `${groups.length}|${index}|${activeId}`;
    },
  }) ?? '0|-1|';

  const [appliedChangeCount, appliedChangeIndex, appliedChangeActiveId] = useMemo(() => {
    const [countStr, indexStr, ...idParts] = appliedChangeNavKey.split('|');
    const count = Number(countStr) || 0;
    const index = Number(indexStr);
    const activeId = idParts.join('|') || null;
    return [count, Number.isNaN(index) ? -1 : index, activeId] as const;
  }, [appliedChangeNavKey]);

  const hasAppliedChanges = appliedChangeCount > 0;

  // 코멘트 버튼 활성 조건 — 텍스트 선택이 있을 때만. 클릭으로 포커스가 옮겨가기 전에 구독값으로 판단한다.
  const hasTextSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? !e.state.selection.empty : false),
  }) ?? false;

  // T 메뉴 버튼에 현재 블록 스타일을 보여준다(Confluence식). heading 1~6 → blockquote → paragraph 순.
  const activeBlock: { kind: 'heading' | 'blockquote' | 'paragraph'; level: number } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (e) {
        for (let level = 6; level >= 1; level -= 1) {
          if (e.isActive('heading', { level })) return { kind: 'heading' as const, level };
        }
        if (e.isActive('blockquote')) return { kind: 'blockquote' as const, level: 0 };
      }
      return { kind: 'paragraph' as const, level: 0 };
    },
  }) ?? { kind: 'paragraph' as const, level: 0 };

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

  // 적용 표시 이전/다음으로 이동 — 범위 선택 + 스크롤은 코멘트 이동(scrollToComment)과 같은 패턴.
  // groups는 클릭 시점에 다시 계산한다(렌더 시점 캐시를 쓰면 편집 후 위치가 어긋남).
  const gotoAppliedChange = useCallback((direction: 1 | -1) => {
    if (!editor) return;
    const groups = getAppliedChangeGroups(editor.state.doc);
    if (groups.length === 0) return;
    const pos = editor.state.selection.from;
    const target = direction > 0
      ? groups.find((g) => g.from > pos) ?? groups[0]!
      : [...groups].reverse().find((g) => g.from < pos) ?? groups[groups.length - 1]!;
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).scrollIntoView().run();
  }, [editor]);

  // 이 문장 확인 — 텍스트는 그대로 두고 해당 changeId(문장 그룹)의 표시만 제거한다.
  const confirmAppliedChangeSentence = useCallback(() => {
    if (!editor || !appliedChangeActiveId) return;
    editor.chain().focus().clearAppliedChangeById(appliedChangeActiveId).run();
  }, [editor, appliedChangeActiveId]);

  // 표 명령은 모두 같은 형태다(포커스 → 명령 → 메뉴 닫기).
  const runTableCommand = useCallback(
    (run: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      run(editor.chain().focus());
      setTableMenuOpen(false);
    },
    [editor],
  );

  // B 메뉴 항목도 같은 형태다(포커스 → 토글 → 메뉴 닫기).
  const runFormatCommand = useCallback(
    (run: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      run(editor.chain().focus());
      setFormatMenuOpen(false);
    },
    [editor],
  );

  // 목록 메뉴 항목도 같은 형태다(포커스 → 토글 → 메뉴 닫기).
  const runListCommand = useCallback(
    (run: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      run(editor.chain().focus());
      setListMenuOpen(false);
    },
    [editor],
  );

  // 서식 지우기(Confluence식 ⌫). 인라인 마크 + 블록 스타일을 함께 리셋한다.
  const clearFormatting = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetAllMarks().clearNodes().run();
    setFormatMenuOpen(false);
    setOverflowMenuOpen(false);
  }, [editor]);

  // 링크 입력창을 열 때 기존 href를 초깃값으로 채운다.
  const openLinkMenu = useCallback(() => {
    if (!editor) return;
    const href = (editor.getAttributes('link').href as string | undefined) ?? '';
    setLinkUrl(href);
    setLinkMenuOpen(true);
  }, [editor]);

  // 스킴이 없으면 https://를 붙인다(Confluence와 같은 규칙).
  const applyLink = useCallback(() => {
    if (!editor || !linkUrl.trim()) return;
    const raw = linkUrl.trim();
    const href = /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(raw) ? raw : `https://${raw}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkMenuOpen(false);
  }, [editor, linkUrl]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkMenuOpen(false);
  }, [editor]);

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

  const toggleBlockquote = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().toggleBlockquote().run();
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

  // Link extension은 붙여넣기 설정(pasteLinkPreserve)에 따라 제외될 수 있다.
  // 스키마에 없으면 버튼 자체를 노출하지 않는다.
  const hasLink = editor.schema.marks.link != null;
  const linkActive = hasLink && isActive('link');

  // 들여쓰기/내어쓰기는 작업 목록 안에서는 taskItem 기준으로 동작한다.
  const indentType: 'listItem' | 'taskItem' = isActive('taskItem') ? 'taskItem' : 'listItem';
  const canSink = editor.can().sinkListItem(indentType);
  const canLift = editor.can().liftListItem(indentType);
  const listActive = isActive('bulletList') || isActive('orderedList') || isActive('taskList');

  const btnBase = 'p-1.5 rounded hover:bg-editor-surface transition-colors';
  const btnActive = 'bg-editor-surface';

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-editor-hairline bg-editor-bg">
      {/* 텍스트 스타일(T) 메뉴 — Confluence식. 블록 스타일을 한 곳에 모은다. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setHeadingMenuOpen(!headingMenuOpen)}
          className={`${btnBase} ${isActive('heading') || isActive('blockquote') ? btnActive : ''} flex items-center gap-0.5 max-w-[132px]`}
          title={t('editor.menuBar.heading')}
          aria-label={t('editor.menuBar.heading')}
          aria-haspopup="menu"
          aria-expanded={headingMenuOpen}
        >
          <Heading size={ICON_SIZE} className="shrink-0" />
          <span className="text-xs truncate">
            {activeBlock.kind === 'heading'
              ? t('editor.menuBar.headingLevel', { level: activeBlock.level })
              : activeBlock.kind === 'blockquote'
                ? t('editor.menuBar.blockquote')
                : t('editor.menuBar.paragraph')}
          </span>
          <ChevronDown size={10} className="shrink-0 opacity-60" />
        </button>
        {headingMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setHeadingMenuOpen(false)}
            />
            <div
              className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded shadow-lg z-50 min-w-[228px] py-1"
              role="menu"
              aria-label={t('editor.menuBar.heading')}
            >
              <button
                type="button"
                role="menuitem"
                onClick={setParagraph}
                className={`
                  flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-editor-bg transition-colors
                  ${isActive('paragraph') ? 'bg-editor-bg font-medium' : ''}
                `}
                aria-label={t('editor.menuBar.paragraph')}
              >
                <Pilcrow size={13} className="shrink-0" />
                <span>{t('editor.menuBar.paragraph')}</span>
                <Kbd label="⌘⌥0" />
              </button>
              <div className="h-px bg-editor-border my-1" />
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <button
                  key={level}
                  type="button"
                  role="menuitem"
                  onClick={() => setHeading(level as 1 | 2 | 3 | 4 | 5 | 6)}
                  className={`
                    flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-editor-bg transition-colors
                    ${isActive('heading', { level }) ? 'bg-editor-bg font-medium' : ''}
                  `}
                  aria-label={t('editor.menuBar.headingLevel', { level })}
                >
                  <span className={`w-7 shrink-0 text-center text-editor-muted ${HEADING_PREVIEW_CLASS[level]}`}>
                    H{level}
                  </span>
                  <span className={HEADING_PREVIEW_CLASS[level]}>
                    {t('editor.menuBar.headingLevel', { level })}
                  </span>
                  <Kbd label={`⌘⌥${level}`} />
                </button>
              ))}
              <div className="h-px bg-editor-border my-1" />
              <button
                type="button"
                role="menuitem"
                aria-pressed={isActive('blockquote')}
                onClick={toggleBlockquote}
                className={`
                  flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-editor-bg transition-colors
                  ${isActive('blockquote') ? 'bg-editor-bg font-medium' : ''}
                `}
                aria-label={t('editor.menuBar.blockquote')}
              >
                <Quote size={13} className="shrink-0" />
                <span>{t('editor.menuBar.blockquote')}</span>
                <Kbd label="⌘⇧B" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 인라인 서식(B) — Confluence식 스플릿 버튼. B는 바로 토글, ▾은 서식 메뉴. */}
      <div className="relative">
        <span className="flex items-center">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`${btnBase} ${isActive('bold') ? btnActive : ''} rounded-r-none`}
            title={t('editor.menuBar.boldTitle')}
            aria-label={t('editor.menuBar.bold')}
          >
            <Bold size={ICON_SIZE} />
          </button>
          <button
            type="button"
            onClick={() => setFormatMenuOpen(!formatMenuOpen)}
            className={`${btnBase} ${formatMenuOpen ? btnActive : ''} rounded-l-none -ml-0.5 px-0.5`}
            title={t('editor.menuBar.formatting')}
            aria-label={t('editor.menuBar.formatting')}
            aria-haspopup="menu"
            aria-expanded={formatMenuOpen}
            data-testid={`editor-menubar-format-${panelType}`}
          >
            <ChevronDown size={10} className="opacity-60" />
          </button>
        </span>
        {formatMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setFormatMenuOpen(false)}
            />
            <div
              className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded-md shadow-overlay z-50 min-w-[212px] py-1"
              role="menu"
              aria-label={t('editor.menuBar.formatting')}
            >
              {FORMAT_MARKS.map(({ key, mark, Icon, shortcut, run }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  aria-pressed={isActive(mark)}
                  aria-label={t(`editor.menuBar.${key}`)}
                  onClick={() => runFormatCommand(run)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors ${isActive(mark) ? 'text-primary-500' : ''}`}
                >
                  <Icon size={13} className="shrink-0" />
                  <span>{t(`editor.menuBar.${key}`)}</span>
                  {shortcut ? <Kbd label={shortcut} /> : null}
                </button>
              ))}

              <div className="border-t border-editor-hairline my-1" />

              <button
                type="button"
                role="menuitem"
                onClick={clearFormatting}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors"
                aria-label={t('editor.menuBar.clearFormatting')}
              >
                <Eraser size={13} className="shrink-0" />
                <span>{t('editor.menuBar.clearFormatting')}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 목록 — Confluence식 스플릿 버튼. •은 바로 토글, ▾은 목록 메뉴. */}
      <div className="relative">
        <span className="flex items-center">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`${btnBase} ${listActive ? btnActive : ''} rounded-r-none`}
            title={t('editor.menuBar.bulletList')}
            aria-label={t('editor.menuBar.bulletList')}
          >
            <List size={ICON_SIZE} />
          </button>
          <button
            type="button"
            onClick={() => setListMenuOpen(!listMenuOpen)}
            className={`${btnBase} ${listMenuOpen ? btnActive : ''} rounded-l-none -ml-0.5 px-0.5`}
            title={t('editor.menuBar.list')}
            aria-label={t('editor.menuBar.list')}
            aria-haspopup="menu"
            aria-expanded={listMenuOpen}
            data-testid={`editor-menubar-list-${panelType}`}
          >
            <ChevronDown size={10} className="opacity-60" />
          </button>
        </span>
        {listMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setListMenuOpen(false)}
            />
            <div
              className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded-md shadow-overlay z-50 min-w-[212px] py-1"
              role="menu"
              aria-label={t('editor.menuBar.list')}
            >
              <button
                type="button"
                role="menuitem"
                aria-pressed={isActive('bulletList')}
                aria-label={t('editor.menuBar.bulletList')}
                onClick={() => runListCommand((c) => { c.toggleBulletList().run(); })}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors ${isActive('bulletList') ? 'text-primary-500' : ''}`}
              >
                <List size={13} className="shrink-0" />
                <span>{t('editor.menuBar.bulletList')}</span>
                <Kbd label="⌘⇧8" />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-pressed={isActive('orderedList')}
                aria-label={t('editor.menuBar.orderedList')}
                onClick={() => runListCommand((c) => { c.toggleOrderedList().run(); })}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors ${isActive('orderedList') ? 'text-primary-500' : ''}`}
              >
                <ListOrdered size={13} className="shrink-0" />
                <span>{t('editor.menuBar.orderedList')}</span>
                <Kbd label="⌘⇧7" />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-pressed={isActive('taskList')}
                aria-label={t('editor.menuBar.taskList')}
                onClick={() => runListCommand((c) => { c.toggleTaskList().run(); })}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors ${isActive('taskList') ? 'text-primary-500' : ''}`}
              >
                <ListTodo size={13} className="shrink-0" />
                <span>{t('editor.menuBar.taskList')}</span>
                <Kbd label="⌘⇧9" />
              </button>

              <div className="border-t border-editor-hairline my-1" />

              <button
                type="button"
                role="menuitem"
                disabled={!canLift}
                aria-label={t('editor.menuBar.outdent')}
                onClick={() => runListCommand((c) => { c.liftListItem(indentType).run(); })}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <IndentDecrease size={13} className="shrink-0" />
                <span>{t('editor.menuBar.outdent')}</span>
                <Kbd label="⇧Tab" />
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canSink}
                aria-label={t('editor.menuBar.indent')}
                onClick={() => runListCommand((c) => { c.sinkListItem(indentType).run(); })}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-editor-bg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <IndentIncrease size={13} className="shrink-0" />
                <span>{t('editor.menuBar.indent')}</span>
                <Kbd label="Tab" />
              </button>
            </div>
          </>
        )}
      </div>


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

      {/* 링크·코멘트 — Confluence식. 링크는 extension이 있을 때만 노출한다. */}
      {hasLink && (
        <div className="relative">
          <button
            type="button"
            onClick={() => (linkMenuOpen ? setLinkMenuOpen(false) : openLinkMenu())}
            className={`${btnBase} ${linkActive ? btnActive : ''}`}
            title={t('editor.menuBar.link')}
            aria-label={t('editor.menuBar.link')}
            aria-haspopup="dialog"
            aria-expanded={linkMenuOpen}
            data-testid={`editor-menubar-link-${panelType}`}
          >
            <Link2 size={ICON_SIZE} />
          </button>
          {linkMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setLinkMenuOpen(false)}
              />
              <div
                className="absolute top-full left-0 mt-1 bg-editor-surface border border-editor-border rounded-md shadow-overlay z-50 min-w-[248px] p-2"
                role="dialog"
                aria-label={t('editor.menuBar.link')}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyLink();
                      else if (e.key === 'Escape') setLinkMenuOpen(false);
                    }}
                    placeholder={t('editor.menuBar.linkPlaceholder')}
                    aria-label={t('editor.menuBar.linkPlaceholder')}
                    data-testid={`editor-menubar-link-input-${panelType}`}
                    className="min-w-0 flex-1 rounded border border-editor-border bg-editor-bg px-2 py-1 text-sm outline-none focus:border-primary-500"
                  />
                  <button
                    type="button"
                    onClick={applyLink}
                    disabled={!linkUrl.trim()}
                    className="shrink-0 rounded bg-primary-fill px-2 py-1 text-sm text-white hover:bg-primary-fill-hover disabled:opacity-40"
                  >
                    {t('editor.menuBar.linkApply')}
                  </button>
                </div>
                {linkActive && (
                  <button
                    type="button"
                    onClick={removeLink}
                    className="mt-1.5 flex items-center gap-2 w-full px-1 py-1 text-sm text-left hover:bg-editor-bg transition-colors"
                    aria-label={t('editor.menuBar.unlink')}
                  >
                    <Link2 size={13} className="shrink-0" />
                    <span>{t('editor.menuBar.unlink')}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {hasLink && onAddComment && (
        <div className="w-px h-5 bg-editor-border mx-1" aria-hidden="true" />
      )}
      {onAddComment && (
        <button
          type="button"
          onClick={onAddComment}
          disabled={!hasTextSelection}
          className={`${btnBase} disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent`}
          title={t('comment.addButton')}
          aria-label={t('comment.addButton')}
          data-testid={`editor-menubar-comment-${panelType}`}
        >
          <NotebookPen size={ICON_SIZE} />
        </button>
      )}

      {/* 구분선 */}
      <div className="w-px h-5 bg-editor-border mx-1" />

      {/* 보기 설정 — 글자 크기·줄 간격은 문서 서식이 아니라 이 패널의 보기 설정이라
          서식 메뉴(T/B)와 분리한다. 연속으로 눌러 맞추는 컨트롤이라 메뉴를 닫지 않는다. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOverflowMenuOpen(!overflowMenuOpen)}
          className={`${btnBase} ${overflowMenuOpen ? btnActive : ''}`}
          title={t('editor.menuBar.viewSettings')}
          aria-label={t('editor.menuBar.viewSettings')}
          aria-haspopup="menu"
          aria-expanded={overflowMenuOpen}
          data-testid={`editor-menubar-viewsettings-${panelType}`}
        >
          <ALargeSmall size={ICON_SIZE} />
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
              aria-label={t('editor.menuBar.viewSettings')}
            >
              <div className="px-3 pt-1 pb-0.5 text-[11px] text-editor-muted" aria-hidden="true">
                {t('editor.menuBar.viewSettings')}
              </div>
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
          <div
            className="flex items-center gap-0.5"
            role="group"
            aria-label={t('editor.menuBar.appliedChangesGroup', '적용 표시 탐색')}
          >
            <button
              type="button"
              onClick={() => gotoAppliedChange(-1)}
              className={btnBase}
              title={t('editor.menuBar.appliedChangesPrev', '이전 적용 표시')}
              aria-label={t('editor.menuBar.appliedChangesPrev', '이전 적용 표시')}
            >
              <ChevronLeft size={ICON_SIZE} />
            </button>
            <span aria-hidden="true" className="min-w-8 text-center text-[11px] tabular-nums text-editor-muted">
              {appliedChangeIndex >= 0
                ? t('editor.menuBar.appliedChangesPosition', '{{current}}/{{total}}', {
                  current: appliedChangeIndex + 1,
                  total: appliedChangeCount,
                })
                : t('editor.menuBar.appliedChangesCount', '{{count}}개', { count: appliedChangeCount })}
            </span>
            <button
              type="button"
              onClick={() => gotoAppliedChange(1)}
              className={btnBase}
              title={t('editor.menuBar.appliedChangesNext', '다음 적용 표시')}
              aria-label={t('editor.menuBar.appliedChangesNext', '다음 적용 표시')}
            >
              <ChevronRight size={ICON_SIZE} />
            </button>
            <button
              type="button"
              onClick={confirmAppliedChangeSentence}
              disabled={!appliedChangeActiveId}
              className={`${btnBase} text-diff-insertion disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent`}
              title={appliedChangeActiveId
                ? t('editor.menuBar.confirmAppliedChangeSentenceTitle', '이 문장의 적용 표시만 지우기 (텍스트는 유지)')
                : t('editor.menuBar.confirmAppliedChangeSentenceDisabledHint', '초록 표시 안에 커서를 두세요')}
              aria-label={t('editor.menuBar.confirmAppliedChangeSentence', '이 문장 확인')}
            >
              <Check size={ICON_SIZE} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().clearAppliedChangeHighlights().run()}
              className={`${btnBase} text-diff-insertion flex items-center gap-1`}
              title={t('editor.menuBar.clearAppliedChanges')}
              aria-label={t('editor.menuBar.clearAppliedChanges')}
            >
              <Eraser size={ICON_SIZE} />
              <span aria-hidden="true" className="text-[11px] tabular-nums">
                {t('editor.menuBar.appliedChangesCount', '{{count}}개', { count: appliedChangeCount })}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
