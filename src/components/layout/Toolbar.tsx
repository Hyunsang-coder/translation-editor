import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { t } = useTranslation();
  const { focusMode, toggleFocusMode, theme, setTheme, toggleSidebar } = useUIStore();
  const { project } = useProjectStore();

  const handleThemeToggle = (): void => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
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
        {/* Chat/Settings Sidebar 토글 */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title={t('toolbar.toggleSidebar')}
        >
          📁
        </button>

        {/* Focus Mode 토글 */}
        <button
          type="button"
          onClick={toggleFocusMode}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium
            transition-colors duration-200
            ${focusMode
              ? 'bg-primary-500 text-white'
              : 'bg-editor-bg text-editor-text hover:bg-editor-border'
            }
          `}
          title={t('toolbar.focusMode')}
        >
          {focusMode ? `📖 ${t('toolbar.focusModeNormal')}` : `🎯 ${t('toolbar.focusModeFocus')}`}
        </button>

        <button
          type="button"
          onClick={handleThemeToggle}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title={t('toolbar.themeCurrent', { theme })}
        >
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>
      </div>
    </header>
  );
}
