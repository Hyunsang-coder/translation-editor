import { ChevronDown, Clipboard, Languages, MessagesSquare, NotebookPen, ScanSearch, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelectionPanel } from '@/types';
import { shortcutLabel } from '@/utils/platform';

/** 인라인 선택 툴바 높이(px) — 선택 영역 위 배치 계산에 쓰인다 */
export const SELECTION_INLINE_TOOLBAR_HEIGHT = 34;

interface SelectionInlineToolbarProps {
  panel?: SelectionPanel;
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

/**
 * 텍스트를 선택하면 선택 영역 위에 자동으로 뜨는 가로 액션 바.
 *
 * 폭은 `w-max`로 고정한다. position:fixed 요소는 기본이 shrink-to-fit이라
 * 오른쪽 끝 근처에서 남은 공간만큼 좁아지고, 그러면 라벨이 줄바꿈되면서
 * `overflow-hidden`에 잘려 정렬이 무너진다.
 *
 * AI 액션(재번역·폴리싱·검수)은 드롭다운 하나로 묶는다. 셋을 나란히 펼치면 바가
 * 선택 영역보다 넓어지고, 자주 쓰는 채팅·코멘트·복사가 뒤로 밀린다.
 */
export function SelectionInlineToolbar({
  panel = 'source',
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
  const [aiMenuOpen, setAiMenuOpen] = useState(false);

  const itemClassName = 'h-[34px] px-3 flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition-colors';

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

  return (
    <div
      ref={containerRef}
      style={style}
      // relative는 드롭다운의 기준점 — 실제 사용에서는 인라인 style의 fixed가 이긴다.
      className="relative w-max"
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && aiMenuOpen) {
          e.stopPropagation();
          setAiMenuOpen(false);
        }
      }}
    >
      <div
        data-testid={`selection-inline-toolbar-${panel}`}
        className="flex w-max items-stretch overflow-hidden rounded-md border border-editor-text bg-editor-surface shadow-lg"
      >
        {aiActions.length > 0 && (
          <button
            type="button"
            data-testid="selection-inline-ai"
            aria-haspopup="menu"
            aria-expanded={aiMenuOpen}
            className={`${itemClassName} bg-primary-fill text-white hover:bg-primary-fill-hover`}
            title={t('editor.selectionAiActions', 'AI')}
            onClick={() => setAiMenuOpen((open) => !open)}
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
          <span className="text-[11px] text-editor-muted">{shortcutLabel('L')}</span>
        </button>

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
      </div>

      {/* 바깥(overflow-hidden 밖)에 띄운다 — 바 안에 두면 잘린다 */}
      {aiMenuOpen && aiActions.length > 0 && (
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
                setAiMenuOpen(false);
                onClick();
              }}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
