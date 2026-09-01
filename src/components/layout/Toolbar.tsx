import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, MessageSquare, Clock3, Download, NotebookPen, RotateCcw } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { isChatPanel } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { useCommentStore } from '@/stores/commentStore';

import { ProjectPicker } from '@/components/layout/ProjectPicker';
import { WorkflowActions } from '@/components/layout/WorkflowActions';
import { HistoryDrawer } from '@/components/history/HistoryDrawer';
import { ExportModal } from '@/components/export/ExportModal';
import { AppSettingsModal, type AppSettingsSection } from '@/components/settings/AppSettingsModal';
import { FOCUS_RING, PRESS, TOOLBAR_LEFT_WIDTH, TOOLBAR_RIGHT_WIDTH } from '@/constants/styles';
import { useTrafficLightInset } from '@/hooks/useTrafficLightInset';

/** 우측 도구 버튼 — 34px 정사각 아이콘 버튼 (라벨은 title/aria-label로 제공) */
const TOOL_BUTTON_CLASS =
  'relative w-[34px] h-[34px] shrink-0 flex items-center justify-center rounded-md text-editor-muted '
  + `hover:bg-editor-border hover:text-editor-text ${PRESS} disabled:opacity-50 disabled:cursor-not-allowed `
  + FOCUS_RING;

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { t } = useTranslation();
  const { openCommentsPanel, toggleChatVisibility, leftSidebar, rightSidebar, floatingChatSessionId } =
    useUIStore(useShallow((s) => ({
      openCommentsPanel: s.openCommentsPanel,
      toggleChatVisibility: s.toggleChatVisibility,
      leftSidebar: s.leftSidebar,
      rightSidebar: s.rightSidebar,
      floatingChatSessionId: s.floatingChatSessionId,
    })));
  const project = useProjectStore((s) => s.project);
  const commentCount = useCommentStore((s) => s.comments.length);
  // 타이틀바를 툴바에 통합했다(titleBarStyle: Overlay) — 신호등이 이 안으로 들어온다.
  const trafficLightInset = useTrafficLightInset();
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  // 앱 설정 모달: 열림 여부와 "열자마자 어느 섹션을 보여줄지"를 한 상태로 든다.
  const [appSettings, setAppSettings] = useState<{ focus?: AppSettingsSection } | null>(null);

  // File 메뉴에서 Export 열기 이벤트 수신
  useEffect(() => {
    const handler = () => setExportModalOpen(true);
    window.addEventListener('app:open-export-modal', handler);
    return () => window.removeEventListener('app:open-export-modal', handler);
  }, []);

  const handleComments = () => {
    if (!project) return;
    openCommentsPanel();
  };

  const handleChat = () => {
    if (!project) return;
    toggleChatVisibility();
  };

  const handleExport = () => {
    if (!project) return;
    setExportModalOpen(true);
  };

  const handleHistory = () => {
    if (!project) return;
    setHistoryDrawerOpen(true);
  };
  const isAnyChatVisible = (
    floatingChatSessionId !== null
    || (!leftSidebar.hidden && leftSidebar.activePanel !== null && isChatPanel(leftSidebar.activePanel))
    || (!rightSidebar.hidden && rightSidebar.activePanel !== null && isChatPanel(rightSidebar.activePanel))
  );

  // Chrome-style zoom indicator: show on change, auto-hide after 2s
  const resetEditorZoom = useUIStore((s) => s.resetEditorZoom);
  const [zoomPercent, setZoomPercent] = useState(() => Math.round(useUIStore.getState().editorZoom * 100));
  const [zoomVisible, setZoomVisible] = useState(false);
  const zoomHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let prevZoom = useUIStore.getState().editorZoom;
    const unsub = useUIStore.subscribe((state) => {
      if (state.editorZoom === prevZoom) return;
      prevZoom = state.editorZoom;
      setZoomPercent(Math.round(state.editorZoom * 100));
      setZoomVisible(true);
      if (zoomHideTimerRef.current) window.clearTimeout(zoomHideTimerRef.current);
      zoomHideTimerRef.current = window.setTimeout(() => setZoomVisible(false), 2000);
    });
    return () => {
      unsub();
      if (zoomHideTimerRef.current) window.clearTimeout(zoomHideTimerRef.current);
    };
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="h-[52px] border-b border-editor-hairline bg-editor-surface flex items-center shrink-0"
    >
      {/* 툴바 3분할 (296 / flex / 308) — 좌·우 슬롯 폭이 아래 컬럼 경계와 정렬된다 */}
      {/* 좌측 슬롯: 프로젝트 선택 (드롭다운) — 아래 영역이 이 프로젝트 소속임을 나타낸다 */}
      <div
        data-tauri-drag-region
        className="flex-none flex items-center min-w-0 px-2 box-border"
        style={{ width: TOOLBAR_LEFT_WIDTH, paddingLeft: trafficLightInset || undefined }}
      >
        <ProjectPicker />
      </div>

      {/* 중앙 슬롯: AI 워크플로 (번역 → 검수 → 폴리싱) + 모델. 프로젝트가 있을 때만 */}
      <div data-tauri-drag-region className="flex-1 min-w-0 flex items-center justify-center">
        {project && <WorkflowActions onOpenModelSettings={() => setAppSettings({ focus: 'modelOverrides' })} />}
      </div>

      {/* 우측 슬롯: 줌 인디케이터 + 도구 (드롭다운 없이 1클릭 접근) */}
      <div data-tauri-drag-region className="flex-none flex items-center gap-1 justify-end pr-2.5 box-border" style={{ minWidth: TOOLBAR_RIGHT_WIDTH }}>
        {/* 배율 인디케이터 — 100%가 아니면 계속 보인다(되돌릴 방법이 항상 있어야 한다).
            100%일 때는 방금 조작했을 때만 잠깐 보여주고 사라진다. */}
        {(zoomVisible || zoomPercent !== 100) && (
          zoomPercent === 100 ? (
            <span className="px-2 h-[26px] inline-flex items-center rounded-md bg-editor-bg border border-editor-border text-[11px] font-medium text-editor-muted animate-fade-in shrink-0 tabular-nums">
              100%
            </span>
          ) : (
            <button
              type="button"
              onClick={resetEditorZoom}
              className={`px-2 h-[26px] inline-flex items-center gap-1 rounded-md bg-editor-bg border border-primary-500 text-[11px] text-primary-600 dark:text-primary-400 hover:bg-editor-border shrink-0 tabular-nums ${PRESS} ${FOCUS_RING}`}
              title={t('editor.zoom.resetTo100', '클릭하면 100%로 되돌립니다')}
              data-testid="toolbar-zoom-reset"
            >
              <span>{zoomPercent}%</span>
              <RotateCcw size={11} />
            </button>
          )
        )}

        <button
          type="button"
          onClick={handleComments}
          disabled={!project}
          className={TOOL_BUTTON_CLASS}
          title={t('comment.title', '코멘트')}
          aria-label={t('comment.title', '코멘트')}
          data-testid="editor-comments-button"
        >
          <NotebookPen size={17} />
          {commentCount > 0 && (
            <span className="absolute top-1 right-0.5 min-w-[14px] h-[14px] px-[3px] box-border rounded-full bg-primary-fill text-white text-[10px] font-semibold leading-[14px] text-center tabular-nums">
              {commentCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleChat}
          disabled={!project}
          aria-pressed={isAnyChatVisible}
          className={`${TOOL_BUTTON_CLASS} ${isAnyChatVisible ? 'text-accent-deep bg-primary-500/10 hover:bg-primary-500/15 hover:text-accent-deep' : ''}`}
          title={t('toolbar.aiChat')}
          aria-label={t('toolbar.aiChat')}
          data-testid="toolbar-menu-chat"
        >
          <MessageSquare size={17} />
        </button>

        <button
          type="button"
          onClick={handleHistory}
          disabled={!project}
          className={TOOL_BUTTON_CLASS}
          title={t('history.title')}
          aria-label={t('history.title')}
          data-testid="toolbar-menu-history"
        >
          <Clock3 size={17} />
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={!project}
          className={TOOL_BUTTON_CLASS}
          title={t('export.title')}
          aria-label={t('toolbar.export', '내보내기')}
          data-testid="toolbar-menu-export"
        >
          <Download size={17} />
        </button>

        <div className="w-px h-[22px] bg-editor-border mx-1.5 shrink-0" />

        {/* 앱 설정 — API 키·모델처럼 프로젝트와 무관한 설정이라 프로젝트 없이도 열린다.
            프로젝트 설정(번역 규칙·용어집·메모리)은 좌측 사이드바의 '설정' 탭이다. */}
        <button
          type="button"
          onClick={() => setAppSettings({})}
          className={TOOL_BUTTON_CLASS}
          title={t('appSettings.title')}
          aria-label={t('appSettings.title')}
          data-testid="toolbar-app-settings-button"
        >
          <Settings size={17} />
        </button>
      </div>

      <HistoryDrawer open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
      <ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />
      {appSettings && (
        <AppSettingsModal focusSection={appSettings.focus} onClose={() => setAppSettings(null)} />
      )}
    </header>
  );
}
