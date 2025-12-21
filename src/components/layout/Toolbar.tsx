import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { focusMode, toggleFocusMode, theme, setTheme, toggleProjectSidebar } = useUIStore();
  const { project } = useProjectStore();

  const handleThemeToggle = (): void => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    if (nextTheme) {
      setTheme(nextTheme);
    }
  };

  return (
    <header className="h-14 border-b border-editor-border bg-editor-surface flex items-center justify-between px-4">
      {/* 프로젝트 정보 */}
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-editor-text">
          {project?.metadata.title ?? 'Untitled Project'}
        </h1>
        <span className="text-sm text-editor-muted">
          {project?.metadata.sourceLanguage ?? ''} → {project?.metadata.targetLanguage ?? ''}
        </span>
      </div>

      {/* 툴바 액션 */}
      <div className="flex items-center gap-2">
        {/* Project Sidebar 토글 */}
        <button
          type="button"
          onClick={toggleProjectSidebar}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title="프로젝트 사이드바 토글"
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
          title="Focus Mode (원문 패널 숨기기)"
        >
          {focusMode ? '📖 Normal' : '🎯 Focus'}
        </button>

        {/* 테마 토글 */}
        <button
          type="button"
          onClick={handleThemeToggle}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title={`Current: ${theme}`}
        >
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '💻'}
        </button>
      </div>
    </header>
  );
}

