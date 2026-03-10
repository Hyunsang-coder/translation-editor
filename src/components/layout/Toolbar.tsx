import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Search, MessageSquare, Clock3, Download } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { isChatPanel } from '@/types';
import { useProjectStore } from '@/stores/projectStore';

import { HistoryDrawer } from '@/components/history/HistoryDrawer';
import { ExportModal } from '@/components/export/ExportModal';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { t } = useTranslation();
  const { openPanel, openReviewPanel, toggleChatVisibility, leftSidebar, rightSidebar } =
    useUIStore(useShallow((s) => ({
      openPanel: s.openPanel,
      openReviewPanel: s.openReviewPanel,
      toggleChatVisibility: s.toggleChatVisibility,
      leftSidebar: s.leftSidebar,
      rightSidebar: s.rightSidebar,
    })));
  const project = useProjectStore((s) => s.project);
const [dropdownOpen, setDropdownOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // File 메뉴에서 Export 열기 이벤트 수신
  useEffect(() => {
    const handler = () => setExportModalOpen(true);
    window.addEventListener('app:open-export-modal', handler);
    return () => window.removeEventListener('app:open-export-modal', handler);
  }, []);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  const handleProjectSettings = () => {
    if (!project) return;
    openPanel('settings');
    setDropdownOpen(false);
  };

  const handleReview = () => {
    if (!project) return;
    openReviewPanel();
    setDropdownOpen(false);
  };

  const handleChat = () => {
    if (!project) return;
    toggleChatVisibility();
    setDropdownOpen(false);
  };

  const handleExport = () => {
    if (!project) return;
    setExportModalOpen(true);
    setDropdownOpen(false);
  };

  const handleHistory = () => {
    if (!project) return;
    setHistoryDrawerOpen(true);
    setDropdownOpen(false);
  };
  const isAnyChatVisible = (
    (!leftSidebar.collapsed && leftSidebar.activePanel !== null && isChatPanel(leftSidebar.activePanel))
    || (!rightSidebar.collapsed && rightSidebar.activePanel !== null && isChatPanel(rightSidebar.activePanel))
  );

  // Chrome-style zoom indicator: show on change, auto-hide after 2s
  const resetEditorZoom = useUIStore((s) => s.resetEditorZoom);
  const [zoomDisplay, setZoomDisplay] = useState<{ visible: boolean; percent: number }>({
    visible: false,
    percent: Math.round(useUIStore.getState().editorZoom * 100),
  });
  const zoomHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = useUIStore.subscribe((state) => {
      const percent = Math.round(state.editorZoom * 100);
      setZoomDisplay({ visible: true, percent });
      if (zoomHideTimerRef.current) window.clearTimeout(zoomHideTimerRef.current);
      zoomHideTimerRef.current = window.setTimeout(
        () => setZoomDisplay((prev) => ({ ...prev, visible: false })),
        2000,
      );
    });
    return unsub;
  }, []);

  return (
    <header className="h-[45px] border-b border-editor-border bg-editor-surface flex items-center justify-between px-4">
      {/* 프로젝트 정보 */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-editor-text">
          {project?.metadata.title ?? t('common.untitledProject')}
        </h1>
      </div>

      {/* 툴바 액션 */}
      <div className="flex items-center gap-2">
        {/* Chrome-style zoom indicator */}
        {zoomDisplay.visible && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-editor-bg border border-editor-border text-[11px] text-editor-muted animate-in fade-in duration-150">
            <span className="font-medium">{zoomDisplay.percent}%</span>
            {zoomDisplay.percent !== 100 && (
              <button
                type="button"
                onClick={resetEditorZoom}
                className="px-1 py-0.5 rounded text-[10px] hover:text-editor-text hover:bg-editor-border transition-colors"
                title={t('editor.zoom.reset', '초기화')}
              >
                {t('editor.zoom.reset', 'Reset')}
              </button>
            )}
          </div>
        )}

        {/* Tools 드롭다운 */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className={`
              p-1.5 rounded-md flex items-center gap-1
              hover:bg-editor-border transition-colors
              ${dropdownOpen ? 'bg-editor-border' : ''}
            `}
            title={t('toolbar.tools')}
            data-testid="toolbar-tools-button"
            aria-haspopup="true"
            aria-expanded={dropdownOpen}
          >
            <img src="/app-icon-64.png" alt="" className="w-6 h-6" />
            <span className="text-xs text-editor-muted">▼</span>
          </button>

          {dropdownOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-editor-border bg-editor-surface shadow-lg overflow-hidden z-50">
              <button
                role="menuitem"
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleChat}
                disabled={!project}
                aria-pressed={isAnyChatVisible}
                data-testid="toolbar-menu-chat"
              >
                <MessageSquare size={16} />
                <span>{t('toolbar.aiChat')}</span>
              </button>
              <div role="separator" className="h-px bg-editor-border" />
              <button
                role="menuitem"
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleReview}
                disabled={!project}
                data-testid="toolbar-menu-review"
              >
                <Search size={16} />
                <span>{t('toolbar.review')}</span>
              </button>
              <div role="separator" className="h-px bg-editor-border" />
              <button
                role="menuitem"
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleHistory}
                disabled={!project}
              >
                <Clock3 size={16} />
                <span>{t('history.title')}</span>
              </button>
              <div role="separator" className="h-px bg-editor-border" />
              <button
                role="menuitem"
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleExport}
                disabled={!project}
                data-testid="toolbar-menu-export"
              >
                <Download size={16} />
                <span>{t('export.title')}</span>
              </button>
              <div role="separator" className="h-px bg-editor-border" />
              <button
                role="menuitem"
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleProjectSettings}
                disabled={!project}
                data-testid="toolbar-menu-settings"
              >
                <Settings size={16} />
                <span>{t('toolbar.projectSettings')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <HistoryDrawer open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
      <ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />
    </header>
  );
}
