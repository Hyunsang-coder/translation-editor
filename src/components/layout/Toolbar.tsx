import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  exportProjectFile,
  importProjectFileSafe,
  listRecentProjects,
  type RecentProjectInfo,
} from '@/tauri/storage';
import { pickExportItePath, pickImportIteFile } from '@/tauri/dialog';
import { loadProject as tauriLoadProject } from '@/tauri/project';
import { useEffect, useMemo, useState } from 'react';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { focusMode, toggleFocusMode, theme, setTheme } = useUIStore();
  const { project, saveProject, loadProject, isDirty, isLoading } = useProjectStore();
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recent, setRecent] = useState<RecentProjectInfo[]>([]);

  const handleSave = async (): Promise<void> => {
    await saveProject();
  };

  const handleExport = async (): Promise<void> => {
    if (!project) return;
    const defaultName = `${project.metadata.title || 'project'}.ite`;
    const path = await pickExportItePath(defaultName);
    if (!path) return;
    await exportProjectFile(path);
    window.alert('Export 완료');
  };

  const handleImport = async (): Promise<void> => {
    const file = await pickImportIteFile();
    if (!file) return;
    const ok = window.confirm(
      'Import는 현재 DB를 덮어씁니다. 진행하기 전에 자동 백업을 생성한 뒤 Import를 수행합니다. 계속할까요?',
    );
    if (!ok) return;
    const res = await importProjectFileSafe(file);
    const firstId = res.projectIds[0];
    if (!firstId) {
      window.alert('Import는 완료되었지만 프로젝트를 찾지 못했습니다.');
      return;
    }
    const loaded = await tauriLoadProject(firstId);
    loadProject(loaded);
    window.alert(`Import 완료\n(자동 백업: ${res.backupPath})`);
  };

  const refreshRecent = async (): Promise<void> => {
    setRecentLoading(true);
    try {
      const list = await listRecentProjects();
      setRecent(list);
    } finally {
      setRecentLoading(false);
    }
  };

  useEffect(() => {
    if (!recentOpen) return;
    void refreshRecent();
  }, [recentOpen]);

  const statusText = useMemo(() => {
    if (isLoading) return 'Saving…';
    if (isDirty) return 'Unsaved';
    return 'Saved';
  }, [isDirty, isLoading]);

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

        {/* 저장 버튼 */}
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-1.5 bg-primary-500 text-white rounded-md text-sm font-medium hover:bg-primary-600 transition-colors"
        >
          Save
        </button>

        <span className="text-xs text-editor-muted px-2 select-none">{statusText}</span>

        {/* Open Recent Projects */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setRecentOpen((v) => !v)}
            className="px-3 py-1.5 bg-editor-bg text-editor-text rounded-md text-sm font-medium hover:bg-editor-border transition-colors"
            title="최근 프로젝트 열기"
          >
            Open
          </button>

          {recentOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-md border border-editor-border bg-editor-surface shadow-xl overflow-hidden z-50">
              <div className="px-3 py-2 flex items-center justify-between border-b border-editor-border">
                <div className="text-xs font-medium text-editor-text">Recent Projects</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary-500 hover:text-primary-600"
                    onClick={() => void refreshRecent()}
                    disabled={recentLoading}
                    title="새로고침"
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="text-xs text-editor-muted hover:text-editor-text"
                    onClick={() => setRecentOpen(false)}
                    title="닫기"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {recentLoading && (
                  <div className="px-3 py-2 text-xs text-editor-muted">불러오는 중...</div>
                )}
                {!recentLoading && recent.length === 0 && (
                  <div className="px-3 py-2 text-xs text-editor-muted">
                    최근 프로젝트가 없습니다.
                  </div>
                )}
                {!recentLoading &&
                  recent.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-editor-bg transition-colors"
                      onClick={() => {
                        void (async () => {
                          const loaded = await tauriLoadProject(p.id);
                          loadProject(loaded);
                          setRecentOpen(false);
                        })();
                      }}
                      title={p.id}
                    >
                      <div className="text-sm text-editor-text truncate">{p.title}</div>
                      <div className="text-[11px] text-editor-muted truncate">{p.id}</div>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Export/Import (파일 다이얼로그) */}
        <button
          type="button"
          onClick={handleExport}
          className="px-3 py-1.5 bg-editor-bg text-editor-text rounded-md text-sm font-medium hover:bg-editor-border transition-colors"
          title="현재 DB를 .ite 파일로 내보내기"
        >
          Export
        </button>
        <button
          type="button"
          onClick={handleImport}
          className="px-3 py-1.5 bg-editor-bg text-editor-text rounded-md text-sm font-medium hover:bg-editor-border transition-colors"
          title=".ite 파일을 불러오기(현재 DB 덮어쓰기)"
        >
          Import
        </button>
      </div>
    </header>
  );
}

