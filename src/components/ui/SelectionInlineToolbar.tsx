import type { Editor } from '@tiptap/react';
import {
  Bold,
  ChevronDown,
  Clipboard,
  Code,
  Heading,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Languages,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  MessagesSquare,
  NotebookPen,
  Pilcrow,
  Quote,
  ScanSearch,
  Sparkles,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Eraser,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelectionPanel } from '@/types';

/** 인라인 선택 툴바 높이(px) — 선택 영역 위 배치 계산에 쓰인다 */
export const SELECTION_INLINE_TOOLBAR_HEIGHT = 34;

interface SelectionInlineToolbarProps {
  panel?: SelectionPanel;
  /** 우측 포맷 섹션(T/B/목록/링크)이 명령을 내릴 에디터. 없으면 좌측+코멘트+복사만 보인다. */
  editor?: Editor | null;
  onCopy: () => void;
  onAddToChat: () => void;
  onRetranslateSelection?: () => void;
  /** target 패널 전용 — 선택 구간만 폴리싱 */
  onPolishSelection?: () => void;
  /** target 패널 전용 — 선택 구간만 검수 */
  onReviewSelection?: () => void;
  onAddComment: () => void;
  style?: React.CSSProperties;
  /** 렌더 후 실제 폭을 재서 화면 안으로 밀어 넣기 위한 ref */
  containerRef?: React.RefObject<HTMLDivElement>;
}

type InlineMenu = 'ai' | 'heading' | 'format' | 'list' | 'link' | null;

function Kbd({ label }: { label: string }): JSX.Element {
  return (
    <kbd className="ml-auto shrink-0 rounded bg-editor-bg px-1.5 py-0.5 text-[11px] text-editor-muted">
      {label}
    </kbd>
  );
}

const HEADING_PREVIEW_CLASS: Record<number, string> = {
  1: 'text-lg font-bold',
  2: 'text-base font-bold',
  3: 'text-[15px] font-bold',
  4: 'text-sm font-semibold',
  5: 'text-[13px] font-semibold',
  6: 'text-xs font-semibold',
};

const FORMAT_MARKS: ReadonlyArray<{
  key: string;
  mark: string;
  Icon: typeof Code;
  shortcut?: string;
}> = [
  { key: 'bold', mark: 'bold', Icon: Bold, shortcut: '⌘B' },
  { key: 'italic', mark: 'italic', Icon: Italic, shortcut: '⌘I' },
  { key: 'underline', mark: 'underline', Icon: Underline },
  { key: 'strikethrough', mark: 'strike', Icon: Strikethrough, shortcut: '⌘⇧S' },
  { key: 'inlineCode', mark: 'code', Icon: Code, shortcut: '⌘E' },
  { key: 'subscript', mark: 'subscript', Icon: Subscript, shortcut: '⌘,' },
  { key: 'superscript', mark: 'superscript', Icon: Superscript, shortcut: '⌘.' },
  { key: 'highlight', mark: 'highlight', Icon: Highlighter, shortcut: '⌘⇧H' },
];

/**
 * 텍스트를 선택하면 선택 영역 위에 자동으로 뜨는 가로 액션 바.
 *
 * 좌측 섹션: AI 드롭다운·채팅 (라벨형 — 주 액션이라 읽기 쉽게 둔다).
 * 우측 섹션: 패널 메뉴(T/B/목록/링크) + 코멘트·복사 (아이콘형 — 폭을 아끼기 위해).
 * 표 메뉴는 인라인에 두지 않는다. 보기 설정(A)도 문서 서식이 아니라 제외한다.
 *
 * 폭은 `w-max`로 고정한다. position:fixed 요소는 기본이 shrink-to-fit이라
 * 오른쪽 끝 근처에서 남은 공간만큼 좁아지고, 그러면 라벨이 줄바꿈되면서
 * `overflow-hidden`에 잘려 정렬이 무너진다.
 */
export function SelectionInlineToolbar({
  panel = 'source',
  editor = null,
  onCopy,
  onAddToChat,
  onRetranslateSelection,
  onPolishSelection,
  onReviewSelection,
  onAddComment,
  style,
  containerRef,
}: SelectionInlineToolbarProps): JSX.Element {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<InlineMenu>(null);
  const [linkUrl, setLinkUrl] = useState('');
  /**
   * 링크 팝오버를 여는 순간의 선택 범위. 입력창에 포커스가 가면 에디터는
   * blur되지만 ProseMirror state의 selection은 유지되므로 보통 복원이 필요
   * 없는데, 혹시 비어 있으면(외부 클릭 등) 이 범위로 되돌려 적용한다.
   */
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null);

  const toggle = (menu: Exclude<InlineMenu, null>): void => {
    setOpenMenu((cur) => (cur === menu ? null : menu));
  };
  const close = (): void => setOpenMenu(null);

  const isActive = (name: string, options?: Record<string, unknown>): boolean =>
    editor?.isActive(name, options) ?? false;

  const itemClassName = 'h-[34px] px-3 flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition-colors';
  const iconBtnClassName = 'h-[34px] w-8 flex items-center justify-center shrink-0 transition-colors';
  const chevronBtnClassName = 'h-[34px] w-5 flex items-center justify-center shrink-0 transition-colors';

  const aiActions = panel === 'target'
    ? [
        onRetranslateSelection && {
          key: 'retranslate',
          Icon: Languages,
          label: t('editor.retranslateSelection'),
          onClick: onRetranslateSelection,
        },
        onPolishSelection && {
          key: 'polish',
          Icon: Sparkles,
          label: t('editor.polishSelection', '폴리싱'),
          onClick: onPolishSelection,
        },
        onReviewSelection && {
          key: 'review',
          Icon: ScanSearch,
          label: t('editor.reviewSelection'),
          onClick: onReviewSelection,
        },
      ].filter((action): action is NonNullable<typeof action> => Boolean(action))
    : [];

  // Link extension은 붙여넣기 설정에 따라 제외될 수 있다. 스키마에 없으면 버튼을 숨긴다.
  const hasLink = editor?.schema.marks.link != null;
  const linkActive = hasLink && isActive('link');

  const indentType: 'listItem' | 'taskItem' = isActive('taskItem') ? 'taskItem' : 'listItem';
  const canSink = editor?.can().sinkListItem(indentType) ?? false;
  const canLift = editor?.can().liftListItem(indentType) ?? false;
  const listActive = isActive('bulletList') || isActive('orderedList') || isActive('taskList');

  const runOnEditor = (run: (chain: ReturnType<Editor['chain']>) => void, menu: Exclude<InlineMenu, null>): void => {
    if (!editor) return;
    run(editor.chain().focus());
    setOpenMenu((cur) => (cur === menu ? null : cur));
  };

  const clearFormatting = (): void => {
    if (!editor) return;
    editor.chain().focus().unsetAllMarks().clearNodes().run();
    close();
  };

  const openLinkMenu = (): void => {
    if (!editor) return;
    const href = (editor.getAttributes('link').href as string | undefined) ?? '';
    setLinkUrl(href);
    const { from, to } = editor.state.selection;
    linkRangeRef.current = to > from ? { from, to } : null;
    setOpenMenu('link');
  };

  const applyLink = (): void => {
    if (!editor || !linkUrl.trim()) return;
    const raw = linkUrl.trim();
    const href = /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(raw) ? raw : `https://${raw}`;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) {
      const saved = linkRangeRef.current;
      if (saved) chain.setTextSelection(saved);
    }
    chain.extendMarkRange('link').setLink({ href }).run();
    linkRangeRef.current = null;
    close();
  };

  const removeLink = (): void => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close();
  };

  return (
    <div
      ref={containerRef}
      style={style}
      // relative는 드롭다운의 기준점 — 실제 사용에서는 인라인 style의 fixed가 이긴다.
      className="relative w-max"
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && openMenu) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div
        data-testid={`selection-inline-toolbar-${panel}`}
        className="flex w-max items-stretch overflow-hidden rounded-md border border-editor-text bg-editor-surface shadow-lg"
      >
        {/* 좌측 섹션 — AI·채팅 (라벨형) */}
        {aiActions.length > 0 && (
          <button
            type="button"
            data-testid="selection-inline-ai"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'ai'}
            className={`${itemClassName} bg-primary-fill text-white hover:bg-primary-fill-hover`}
            title={t('editor.selectionAiActions', 'AI')}
            onClick={() => toggle('ai')}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{t('editor.selectionAiActions', 'AI')}</span>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </button>
        )}

        <button
          type="button"
          data-testid="selection-inline-add-chat"
          className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline first:border-l-0`}
          title={t('editor.addToChat')}
          onClick={onAddToChat}
        >
          <MessagesSquare className="w-3.5 h-3.5 shrink-0" />
          <span>{t('editor.addToChatLabel')}</span>
        </button>

        {editor && (
          <>
            {/* 좌/우 섹션 구분선 */}
            <div className="w-px self-stretch bg-editor-border" aria-hidden="true" />

            {/* 우측 섹션 — 패널 메뉴 (아이콘형). 표·보기 설정은 제외. */}
            <button
              type="button"
              data-testid="selection-inline-heading"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'heading'}
              aria-label={t('editor.menuBar.heading')}
              title={t('editor.menuBar.heading')}
              onClick={() => toggle('heading')}
              className={`${iconBtnClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
            >
              <Heading className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              data-testid="selection-inline-bold"
              aria-label={t('editor.menuBar.bold')}
              title={t('editor.menuBar.boldTitle')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`${iconBtnClassName} ${isActive('bold') ? 'text-primary-500' : 'text-editor-text'} hover:bg-editor-border/60 border-l border-editor-hairline`}
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="selection-inline-format"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'format'}
              aria-label={t('editor.menuBar.formatting')}
              title={t('editor.menuBar.formatting')}
              onClick={() => toggle('format')}
              className={`${chevronBtnClassName} text-editor-text hover:bg-editor-border/60`}
            >
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            <button
              type="button"
              data-testid="selection-inline-bullet-list"
              aria-label={t('editor.menuBar.bulletList')}
              title={t('editor.menuBar.bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`${iconBtnClassName} ${listActive ? 'text-primary-500' : 'text-editor-text'} hover:bg-editor-border/60 border-l border-editor-hairline`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="selection-inline-list-menu"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'list'}
              aria-label={t('editor.menuBar.list')}
              title={t('editor.menuBar.list')}
              onClick={() => toggle('list')}
              className={`${chevronBtnClassName} text-editor-text hover:bg-editor-border/60`}
            >
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {hasLink && (
              <button
                type="button"
                data-testid="selection-inline-link"
                aria-haspopup="dialog"
                aria-expanded={openMenu === 'link'}
                aria-label={t('editor.menuBar.link')}
                title={t('editor.menuBar.link')}
                onClick={() => (openMenu === 'link' ? close() : openLinkMenu())}
                className={`${iconBtnClassName} ${linkActive ? 'text-primary-500' : 'text-editor-text'} hover:bg-editor-border/60 border-l border-editor-hairline`}
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              data-testid="selection-inline-comment"
              aria-label={t('comment.addButton')}
              title={t('comment.addButton')}
              onClick={onAddComment}
              className={`${iconBtnClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
            >
              <NotebookPen className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              data-testid="selection-inline-copy"
              aria-label={t('editor.copySelection')}
              title={t('editor.copySelection')}
              onClick={onCopy}
              className={`${iconBtnClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {!editor && (
          <>
            <button
              type="button"
              data-testid="selection-inline-comment"
              className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
              title={t('comment.addButton')}
              onClick={onAddComment}
            >
              <NotebookPen className="w-3.5 h-3.5 shrink-0" />
              <span>{t('comment.addButton')}</span>
            </button>

            <button
              type="button"
              data-testid="selection-inline-copy"
              className={`${itemClassName} text-editor-text hover:bg-editor-border/60 border-l border-editor-hairline`}
              title={t('editor.copySelection')}
              onClick={onCopy}
            >
              <Clipboard className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.copySelection')}</span>
            </button>
          </>
        )}
      </div>

      {/* 바깥(overflow-hidden 밖)에 띄운다 — 바 안에 두면 잘린다 */}
      {openMenu === 'ai' && aiActions.length > 0 && (
        <div
          role="menu"
          data-testid="selection-inline-ai-menu"
          className="absolute left-0 top-full mt-1 min-w-[170px] overflow-hidden rounded-md border border-editor-text bg-editor-surface shadow-lg"
        >
          {aiActions.map(({ key, Icon, label, onClick }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              data-testid={`selection-inline-${key}`}
              className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-xs font-semibold text-editor-text transition-colors hover:bg-editor-border/60"
              title={label}
              onClick={() => {
                close();
                onClick();
              }}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {openMenu === 'heading' && editor && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            aria-label={t('editor.menuBar.heading')}
            className="absolute left-0 top-full z-50 mt-1 min-w-[228px] rounded border border-editor-border bg-editor-surface py-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              aria-label={t('editor.menuBar.paragraph')}
              onClick={() => runOnEditor((c) => { c.setParagraph().run(); }, 'heading')}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-editor-bg"
            >
              <Pilcrow className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.paragraph')}</span>
              <Kbd label="⌘⌥0" />
            </button>
            <div className="my-1 h-px bg-editor-border" />
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <button
                key={level}
                type="button"
                role="menuitem"
                aria-label={t('editor.menuBar.headingLevel', { level })}
                onClick={() => runOnEditor((c) => { c.toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run(); }, 'heading')}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-editor-bg"
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
            <div className="my-1 h-px bg-editor-border" />
            <button
              type="button"
              role="menuitem"
              aria-label={t('editor.menuBar.blockquote')}
              onClick={() => runOnEditor((c) => { c.toggleBlockquote().run(); }, 'heading')}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-editor-bg"
            >
              <Quote className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.blockquote')}</span>
              <Kbd label="⌘⇧B" />
            </button>
          </div>
        </>
      )}

      {openMenu === 'format' && editor && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            aria-label={t('editor.menuBar.formatting')}
            className="absolute left-0 top-full z-50 mt-1 min-w-[212px] rounded-md border border-editor-border bg-editor-surface py-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {FORMAT_MARKS.map(({ key, mark, Icon, shortcut }) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                aria-pressed={isActive(mark)}
                aria-label={t(`editor.menuBar.${key}`)}
                onClick={() => runOnEditor((c) => {
                  if (mark === 'bold') c.toggleBold().run();
                  else if (mark === 'italic') c.toggleItalic().run();
                  else if (mark === 'underline') c.toggleUnderline().run();
                  else if (mark === 'strike') c.toggleStrike().run();
                  else if (mark === 'code') c.toggleCode().run();
                  else if (mark === 'subscript') c.toggleSubscript().run();
                  else if (mark === 'superscript') c.toggleSuperscript().run();
                  else if (mark === 'highlight') c.toggleHighlight().run();
                }, 'format')}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg ${isActive(mark) ? 'text-primary-500' : ''}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{t(`editor.menuBar.${key}`)}</span>
                {shortcut ? <Kbd label={shortcut} /> : null}
              </button>
            ))}
            <div className="my-1 border-t border-editor-hairline" />
            <button
              type="button"
              role="menuitem"
              aria-label={t('editor.menuBar.clearFormatting')}
              onClick={clearFormatting}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg"
            >
              <Eraser className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.clearFormatting')}</span>
            </button>
          </div>
        </>
      )}

      {openMenu === 'list' && editor && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            aria-label={t('editor.menuBar.list')}
            className="absolute left-0 top-full z-50 mt-1 min-w-[212px] rounded-md border border-editor-border bg-editor-surface py-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              aria-pressed={isActive('bulletList')}
              aria-label={t('editor.menuBar.bulletList')}
              onClick={() => runOnEditor((c) => { c.toggleBulletList().run(); }, 'list')}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg ${isActive('bulletList') ? 'text-primary-500' : ''}`}
            >
              <List className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.bulletList')}</span>
              <Kbd label="⌘⇧8" />
            </button>
            <button
              type="button"
              role="menuitem"
              aria-pressed={isActive('orderedList')}
              aria-label={t('editor.menuBar.orderedList')}
              onClick={() => runOnEditor((c) => { c.toggleOrderedList().run(); }, 'list')}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg ${isActive('orderedList') ? 'text-primary-500' : ''}`}
            >
              <ListOrdered className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.orderedList')}</span>
              <Kbd label="⌘⇧7" />
            </button>
            <button
              type="button"
              role="menuitem"
              aria-pressed={isActive('taskList')}
              aria-label={t('editor.menuBar.taskList')}
              onClick={() => runOnEditor((c) => { c.toggleTaskList().run(); }, 'list')}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg ${isActive('taskList') ? 'text-primary-500' : ''}`}
            >
              <ListTodo className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.taskList')}</span>
              <Kbd label="⌘⇧9" />
            </button>
            <div className="my-1 border-t border-editor-hairline" />
            <button
              type="button"
              role="menuitem"
              disabled={!canLift}
              aria-label={t('editor.menuBar.outdent')}
              onClick={() => runOnEditor((c) => { c.liftListItem(indentType).run(); }, 'list')}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <IndentDecrease className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.outdent')}</span>
              <Kbd label="⇧Tab" />
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canSink}
              aria-label={t('editor.menuBar.indent')}
              onClick={() => runOnEditor((c) => { c.sinkListItem(indentType).run(); }, 'list')}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-editor-bg disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <IndentIncrease className="w-3.5 h-3.5 shrink-0" />
              <span>{t('editor.menuBar.indent')}</span>
              <Kbd label="Tab" />
            </button>
          </div>
        </>
      )}

      {openMenu === 'link' && editor && hasLink && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="dialog"
            aria-label={t('editor.menuBar.link')}
            className="absolute right-0 top-full z-50 mt-1 min-w-[248px] rounded-md border border-editor-border bg-editor-surface p-2 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyLink();
                  else if (e.key === 'Escape') close();
                }}
                placeholder={t('editor.menuBar.linkPlaceholder')}
                aria-label={t('editor.menuBar.linkPlaceholder')}
                data-testid="selection-inline-link-input"
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
                aria-label={t('editor.menuBar.unlink')}
                className="mt-1.5 flex w-full items-center gap-2 px-1 py-1 text-left text-sm transition-colors hover:bg-editor-bg"
              >
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t('editor.menuBar.unlink')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
