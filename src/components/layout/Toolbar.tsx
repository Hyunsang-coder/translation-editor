import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, Settings, Search, MessageSquare, Cog } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { AppSettingsModal } from '@/components/settings/AppSettingsModal';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { t } = useTranslation();
  const { focusMode, toggleFocusMode, setSidebarCollapsed, setSidebarActiveTab, openReviewPanel, chatPanelOpen, toggleChatPanel } = useUIStore();
  const { project } = useProjectStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    setSidebarCollapsed(false);
    setSidebarActiveTab('settings');
    setDropdownOpen(false);
  };

  const handleReview = () => {
    openReviewPanel();
    setDropdownOpen(false);
  };

  const handleChat = () => {
    toggleChatPanel();
    setDropdownOpen(false);
  };

  const handleAppSettings = () => {
    setShowAppSettings(true);
    setDropdownOpen(false);
  };

  return (
    <header className="h-14 border-b border-editor-border bg-editor-surface flex items-center justify-between px-4">
      {/* 프로젝트 정보 */}
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-editor-text">
          {project?.metadata.title ?? t('common.untitledProject')}
        </h1>
      </div>

      {/* 툴바 액션 */}
      <div className="flex items-center gap-2">
        {/* Focus Mode 토글 */}
        <button
          type="button"
          onClick={toggleFocusMode}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title={t('toolbar.focusMode')}
        >
          {focusMode ? '👁️' : '👀'}
        </button>

        {/* Tools 드롭다운 */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className={`
              p-2 rounded-md flex items-center gap-1
              hover:bg-editor-border transition-colors
              ${dropdownOpen ? 'bg-editor-border' : ''}
            `}
            title={t('toolbar.tools')}
          >
            <Wrench size={18} className="text-editor-text" />
            <span className="text-xs text-editor-muted">▼</span>
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-editor-border bg-editor-surface shadow-lg overflow-hidden z-50">
              <button
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2"
                onClick={handleChat}
                aria-pressed={chatPanelOpen}
              >
                <MessageSquare size={16} />
                <span className="flex-1">{t('toolbar.chat')}</span>
                {chatPanelOpen && (
                  <span className="text-xs text-accent-primary">ON</span>
                )}
              </button>
              <div className="h-px bg-editor-border" />
              <button
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2"
                onClick={handleReview}
              >
                <Search size={16} />
                <span>{t('toolbar.review')}</span>
              </button>
              <div className="h-px bg-editor-border" />
              <button
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2"
                onClick={handleProjectSettings}
              >
                <Settings size={16} />
                <span>{t('toolbar.projectSettings')}</span>
              </button>
              <div className="h-px bg-editor-border" />
              <button
                type="button"
                className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors flex items-center gap-2"
                onClick={handleAppSettings}
              >
                <Cog size={16} />
                <span>{t('projectSidebar.appSettings')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* App Settings Modal */}
      {showAppSettings && (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      )}
    </header>
  );
}
