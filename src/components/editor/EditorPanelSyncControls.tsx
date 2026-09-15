import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { FOCUS_RING } from '@/constants/styles';

interface EditorPanelSyncControlsProps {
  /** 원문/번역문이 동시에 표시되는 문서 보기 상태인지 */
  available: boolean;
}

/**
 * 2분할 편집 패널 전용 환경설정.
 * 체크 상태는 단일 패널/정렬 검사 뷰에서도 유지되며, 적용 가능할 때만 활성화된다.
 */
export function EditorPanelSyncControls({
  available,
}: EditorPanelSyncControlsProps): JSX.Element {
  const { t } = useTranslation();
  const equalEditorPanelWidths = useUIStore((s) => s.equalEditorPanelWidths);
  const editorScrollSyncEnabled = useUIStore((s) => s.editorScrollSyncEnabled);
  const setEqualEditorPanelWidths = useUIStore((s) => s.setEqualEditorPanelWidths);
  const setEditorScrollSyncEnabled = useUIStore((s) => s.setEditorScrollSyncEnabled);
  const unavailableTitle = t(
    'editor.panelSync.requiresBothPanels',
    '원문과 번역문을 모두 표시할 때 사용할 수 있습니다.',
  );

  const labelClass = [
    'h-[26px] inline-flex items-center gap-1.5 px-2 text-[11px] font-medium',
    'text-editor-muted rounded hover:bg-editor-border cursor-pointer',
    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary-focus has-[:focus-visible]:outline-offset-2',
    !available ? 'opacity-45 cursor-not-allowed hover:bg-transparent' : '',
  ].join(' ');

  return (
    <div
      className="flex items-center shrink-0 border-l border-editor-hairline pl-1"
      aria-label={t('editor.panelSync.label', '패널 동기화')}
    >
      <label
        className={labelClass}
        title={available
          ? t('editor.panelSync.equalWidthsTitle', '원문과 번역문 패널을 같은 너비로 고정')
          : unavailableTitle}
      >
        <input
          type="checkbox"
          className={`h-3 w-3 accent-primary-500 ${FOCUS_RING}`}
          checked={equalEditorPanelWidths}
          disabled={!available}
          onChange={(event) => setEqualEditorPanelWidths(event.target.checked)}
          data-testid="editor-equal-widths-checkbox"
        />
        <span>{t('editor.panelSync.equalWidths', '같은 너비')}</span>
      </label>

      <label
        className={labelClass}
        title={available
          ? t('editor.panelSync.syncPositionTitle', '대응 문단을 같은 화면 높이에 유지')
          : unavailableTitle}
      >
        <input
          type="checkbox"
          className={`h-3 w-3 accent-primary-500 ${FOCUS_RING}`}
          checked={editorScrollSyncEnabled}
          disabled={!available}
          onChange={(event) => setEditorScrollSyncEnabled(event.target.checked)}
          data-testid="editor-scroll-sync-checkbox"
        />
        <span>{t('editor.panelSync.syncPosition', '위치 동기화')}</span>
      </label>
    </div>
  );
}
