import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  exportProjectFile,
  importProjectFileSafe,
  listRecentProjects,
  deleteProject,
  deleteAllProjects,
  type RecentProjectInfo,
} from '@/tauri/storage';
import { pickExportItePath, pickImportIteFile } from '@/tauri/dialog';
import { loadProject as tauriLoadProject } from '@/tauri/project';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useState } from 'react';

/**
 * 상단 툴바 컴포넌트
 */
export function Toolbar(): JSX.Element {
  const { focusMode, toggleFocusMode, theme, setTheme } = useUIStore();
  const { project, saveProject, loadProject, isDirty, isLoading, stopAutoSave, startAutoSave } =
    useProjectStore();
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recent, setRecent] = useState<RecentProjectInfo[]>([]);

  const askConfirm = async (text: string, title: string): Promise<boolean> => {
    try {
      return await confirm(text, { title, kind: 'warning', buttons: 'YesNo' });
    } catch {
      // fallback (비-Tauri 환경 등)
      return window.confirm(text);
    }
  };

  const showMessage = async (text: string, title: string, kind: 'info' | 'warning' | 'error') => {
    try {
      await message(text, { title, kind });
    } catch {
      window.alert(text);
    }
  };

  const handleSave = async (): Promise<void> => {
    await saveProject();
  };

  const handleExport = async (): Promise<void> => {
    if (!project) return;
    const defaultName = `${project.metadata.title || 'project'}.ite`;
    const path = await pickExportItePath(defaultName);
    if (!path) return;
    try {
      await exportProjectFile(path);
      await showMessage(`Export 완료\n경로: ${path}`, 'Export', 'info');
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : (() => {
                try {
                  return JSON.stringify(e);
                } catch {
                  return String(e);
                }
              })();
      await showMessage(`Export 실패\n\n경로: ${path}\n오류: ${msg}`, 'Export 실패', 'error');
    }
  };

  const handleImport = async (): Promise<void> => {
    const file = await pickImportIteFile();
    if (!file) return;
    const ok = await askConfirm(
      'Import는 현재 DB를 덮어씁니다. 진행하기 전에 자동 백업을 생성한 뒤 Import를 수행합니다. 계속할까요?',
      'Import 확인',
    );
    if (!ok) return;
    // autosave/저장과 DB lock 경쟁을 피하기 위해, import 동안 일시 중지
    stopAutoSave();
    try {
      const res = await importProjectFileSafe(file);
      const firstId = res.projectIds[0];
      if (!firstId) {
        await showMessage('Import는 완료되었지만 프로젝트를 찾지 못했습니다.', 'Import', 'warning');
        return;
      }
      const loaded = await tauriLoadProject(firstId);
      loadProject(loaded);
      await showMessage(`Import 완료\n(자동 백업: ${res.backupPath})`, 'Import', 'info');
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : (() => {
                try {
                  return JSON.stringify(e);
                } catch {
                  return String(e);
                }
              })();
      await showMessage(`Import 실패\n\n오류: ${msg}`, 'Import 실패', 'error');
    } finally {
      // import 후 자동 저장 재개
      startAutoSave();
    }
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

  const handleDeleteRecent = async (projectId: string): Promise<void> => {
    const ok = await askConfirm(
      '이 프로젝트를 삭제할까요?\n(최근 목록에서 제거되며, DB에서 삭제됩니다)',
      '프로젝트 삭제',
    );
    if (!ok) return;
    await deleteProject(projectId);
    await refreshRecent();
  };

  const handleClearAllRecent = async (): Promise<void> => {
    const ok = await askConfirm(
      '모든 프로젝트를 삭제할까요?\n(최근 목록이 비워지며, DB의 프로젝트가 모두 삭제됩니다)',
      '전체 삭제',
    );
    if (!ok) return;
    await deleteAllProjects();
    await refreshRecent();
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
                    className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                    onClick={() => void handleClearAllRecent()}
                    disabled={recentLoading || recent.length === 0}
                    title="전체 삭제"
                  >
                    Clear All
                  </button>
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
                    <div
                      key={p.id}
                      className="flex items-stretch gap-1 px-2 py-1 hover:bg-editor-bg transition-colors"
                      title={p.id}
                    >
                      <button
                        type="button"
                        className="flex-1 text-left px-1.5 py-1 rounded hover:bg-editor-bg transition-colors"
                        onClick={() => {
                          void (async () => {
                            try {
                              const loaded = await tauriLoadProject(p.id);
                              loadProject(loaded);
                              setRecentOpen(false);
                            } catch (e) {
                              const msg =
                                e instanceof Error ? e.message : '프로젝트 로드에 실패했습니다.';
                              await showMessage(
                                `프로젝트를 열 수 없습니다.\n\nID: ${p.id}\n오류: ${msg}`,
                                '프로젝트 로드 실패',
                                'error',
                              );
                              const ok = await askConfirm(
                                '이 항목을 최근 목록에서 삭제할까요?\n(최근 목록에서 제거되며, DB에서 삭제됩니다)',
                                '삭제 확인',
                              );
                              if (ok) {
                                try {
                                  await deleteProject(p.id);
                                } finally {
                                  await refreshRecent();
                                }
                              }
                            }
                          })();
                        }}
                      >
                        <div className="text-sm text-editor-text truncate">{p.title}</div>
                        <div className="text-[11px] text-editor-muted truncate">{p.id}</div>
                      </button>
                      <button
                        type="button"
                        className="px-2 text-sm text-editor-muted hover:text-red-600 transition-colors"
                        onClick={() => void handleDeleteRecent(p.id)}
                        title="삭제"
                      >
                        🗑
                      </button>
                    </div>
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

