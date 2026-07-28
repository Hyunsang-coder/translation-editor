import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, MessageSquare, Clock3, Download, NotebookPen, PanelLeft, PanelLeftOpen } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { isChatPanel } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { useCommentStore } from '@/stores/commentStore';

import { WorkflowActions } from '@/components/layout/WorkflowActions';
import { HistoryDrawer } from '@/components/history/HistoryDrawer';
import { ExportModal } from '@/components/export/ExportModal';

const TOOL_BUTTON_CLASS =
  'h-[34px] px-[11px] flex items-center gap-[7px] rounded-md text-[13px] font-semibold text-editor-text '
  + 'hover:bg-editor-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed '
  + 'focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { t } = useTranslation();
  const { openPanel, openCommentsPanel, toggleChatVisibility, leftSidebar, rightSidebar, floatingChatSessionId, projectSidebarCollapsed, toggleProjectSidebar } =
    useUIStore(useShallow((s) => ({
      openPanel: s.openPanel,
      openCommentsPanel: s.openCommentsPanel,
      toggleChatVisibility: s.toggleChatVisibility,
      leftSidebar: s.leftSidebar,
      rightSidebar: s.rightSidebar,
      floatingChatSessionId: s.floatingChatSessionId,
      projectSidebarCollapsed: s.projectSidebarCollapsed,
      toggleProjectSidebar: s.toggleProjectSidebar,
    })));
  const project = useProjectStore((s) => s.project);
  const commentCount = useCommentStore((s) => s.comments.length);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // File 메뉴에서 Export 열기 이벤트 수신
  useEffect(() => {
    const handler = () => setExportModalOpen(true);
    window.addEventListener('app:open-export-modal', handler);
    return () => window.removeEventListener('app:open-export-modal', handler);
  }, []);

  const handleProjectSettings = () => {
    if (!project) return;
    openPanel('settings');
  };

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
    <header className="h-[52px] border-b border-editor-border bg-editor-surface flex items-center justify-between gap-3 px-2 shrink-0">
      {/* 좌측: 사이드바 토글 + 프로젝트 제목 (아래 영역이 이 프로젝트 소속임을 나타냄) */}
      <div className="flex items-center gap-1.5 min-w-0 shrink">
        <button
          type="button"
          onClick={toggleProjectSidebar}
          className="p-1.5 rounded-md text-editor-muted hover:text-editor-text hover:bg-editor-border transition-colors shrink-0"
          title={projectSidebarCollapsed ? t('projectSidebar.showSidebar') : t('projectSidebar.collapseSidebar')}
          aria-label={projectSidebarCollapsed ? t('projectSidebar.showSidebar') : t('projectSidebar.collapseSidebar')}
          data-testid="toolbar-sidebar-toggle"
        >
          {projectSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeft size={18} />}
        </button>
        <h1 className="text-sm font-extrabold text-editor-text truncate">
          {project?.metadata.title ?? t('common.untitledProject')}
        </h1>
      </div>

      {/* 중앙: AI 워크플로 (번역 → 검수 → 폴리싱) + 모델 */}
      <div className="shrink-0">
        <WorkflowActions />
      </div>

      {/* 우측: 줌 인디케이터 + 도구 (드롭다운 없이 1클릭 접근) */}
      <div className="flex items-center gap-1 min-w-0 justify-end">
        {/* Chrome-style zoom indicator */}
        {zoomVisible && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-editor-bg border border-editor-border text-[11px] text-editor-muted animate-in fade-in duration-150 shrink-0">
            <span className="font-medium">{zoomPercent}%</span>
            {zoomPercent !== 100 && (
              <button
                type="button"
                onClick={resetEditorZoom}
                className="px-1 py-0.5 rounded text-[11px] hover:text-editor-text hover:bg-editor-border transition-colors"
                title={t('editor.zoom.reset', '초기화')}
              >
                {t('editor.zoom.reset', 'Reset')}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleComments}
          disabled={!project}
          className={TOOL_BUTTON_CLASS}
          title={t('comment.title', '코멘트')}
          data-testid="editor-comments-button"
        >
          <NotebookPen size={16} />
          <span>{t('comment.title', '코멘트')}</span>
          {commentCount > 0 && (
            <span className="tabular-nums text-editor-muted">{commentCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={handleChat}
          disabled={!project}
          aria-pressed={isAnyChatVisible}
          className={TOOL_BUTTON_CLASS}
          title={t('toolbar.aiChat')}
          data-testid="toolbar-menu-chat"
        >
          <MessageSquare size={16} />
          <span>{t('toolbar.aiChat')}</span>
        </button>

        <button
          type="button"
          onClick={handleHistory}
          disabled={!project}
          className={TOOL_BUTTON_CLASS}
          title={t('history.title')}
          data-testid="toolbar-menu-history"
        >
          <Clock3 size={16} />
          <span>{t('history.title')}</span>
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={!project}
          className={TOOL_BUTTON_CLASS}
          title={t('export.title')}
          data-testid="toolbar-menu-export"
        >
          <Download size={16} />
          <span>{t('toolbar.export', '내보내기')}</span>
        </button>

        <div className="w-px h-[22px] bg-editor-border mx-1.5 shrink-0" />

        <button
          type="button"
          onClick={handleProjectSettings}
          disabled={!project}
          className="h-[34px] px-2 flex items-center rounded-md text-editor-text hover:bg-editor-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2"
          title={t('toolbar.projectSettings')}
          aria-label={t('toolbar.projectSettings')}
          data-testid="toolbar-menu-settings"
        >
          <Settings size={17} />
        </button>
      </div>

      <HistoryDrawer open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
      <ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />
    </header>
  );
}
