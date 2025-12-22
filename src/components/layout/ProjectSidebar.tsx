import { useEffect, useMemo, useState } from 'react';
import { listRecentProjects, deleteProject, type RecentProjectInfo } from '@/tauri/storage';
import { createProject } from '@/tauri/project';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import type { ProjectDomain } from '@/types';
import { confirm, message } from '@tauri-apps/plugin-dialog';

type NewProjectForm = {
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain: ProjectDomain;
};

export function ProjectSidebar(): JSX.Element {
  const projectSidebarCollapsed = useUIStore((s) => s.projectSidebarCollapsed);
  const toggleProjectSidebar = useUIStore((s) => s.toggleProjectSidebar);
  const project = useProjectStore((s) => s.project);
  const error = useProjectStore((s) => s.error);
  const switchProjectById = useProjectStore((s) => s.switchProjectById);
  const loadProject = useProjectStore((s) => s.loadProject);
  const saveProject = useProjectStore((s) => s.saveProject);

  const [items, setItems] = useState<RecentProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewProjectForm>({
    title: 'New Project',
    sourceLanguage: 'English',
    targetLanguage: 'Korean',
    domain: 'general',
  });

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);

  const selectedId = project?.id ?? null;

  const sorted = useMemo(() => {
    // backend가 updated_at desc지만, 방어적으로 한 번 더 정렬
    return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [items]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await listRecentProjects();
      setItems(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '프로젝트 목록 로드 실패';
      await message(msg, { title: 'Projects', kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Close context menu on global click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  if (projectSidebarCollapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4 bg-editor-surface border-r border-editor-border">
        <button
          type="button"
          onClick={toggleProjectSidebar}
          className="p-2 rounded-md hover:bg-editor-border transition-colors text-editor-muted"
          title="Show sidebar"
        >
          {/* Sidebar Expand Icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </div>
    );
  }

  const handleNewProject = async (): Promise<void> => {
    const ok = await confirm('새 프로젝트를 생성할까요?', {
      title: 'New Project',
      kind: 'info',
    });
    if (!ok) return;

    // 기존 프로젝트가 있고 변경사항이 있으면 먼저 저장
    const { project: currentProject, isDirty, saveProject: doSave } = useProjectStore.getState();
    if (currentProject && isDirty) {
      try {
        await doSave();
      } catch (e) {
        console.warn('[handleNewProject] Failed to save previous project:', e);
        // 저장 실패해도 새 프로젝트 생성 진행
      }
    }

    const created = await createProject({
      title: form.title.trim() || 'New Project',
      sourceLanguage: form.sourceLanguage.trim() || 'English',
      targetLanguage: form.targetLanguage.trim() || 'Korean',
      domain: 'general', // Force general
    });

    // create_project는 DB에 저장까지 수행하므로, 바로 로드
    loadProject(created);
    setShowNew(false);
    await refresh();
  };

  const handleDelete = async (projectId: string): Promise<void> => {
    const ok = await confirm('이 프로젝트를 삭제할까요?\n(DB에서 삭제되며 복구할 수 없습니다)', {
      title: '프로젝트 삭제',
      kind: 'warning',
    });
    if (!ok) return;
    await deleteProject(projectId);
    await refresh();

    if (selectedId === projectId) {
      await message('현재 열려있던 프로젝트가 삭제되었습니다.\n다른 프로젝트를 선택해 주세요.', {
        title: '삭제됨',
        kind: 'warning',
      });
    }
  };

  const handleRename = async (projectId: string): Promise<void> => {
    const target = items.find((i) => i.id === projectId);
    if (!target) return;

    // TODO: Use a better UI than prompt if possible, but prompt is simple and robust
    const newTitle = window.prompt('프로젝트 이름 변경:', target.title);
    if (!newTitle || newTitle.trim() === target.title) return;

    // If it's the current project, update store and save
    if (selectedId === projectId && project) {
      useProjectStore.setState({
        project: {
          ...project,
          metadata: { ...project.metadata, title: newTitle.trim(), updatedAt: Date.now() },
        },
        isDirty: true,
      });
      await saveProject(); // Save changes to files
      await refresh();
      return;
    }

    // If it's NOT the current project, we need to load-change-save
    try {
      setLoading(true);
      // Temporarily import helpers to avoid hooking into store if easier
      const { loadProject: tauriLoad, saveProject: tauriSave } = await import('@/tauri/project');
      const loaded = await tauriLoad(projectId);
      const updated = {
        ...loaded,
        metadata: {
          ...loaded.metadata,
          title: newTitle.trim(),
          updatedAt: Date.now(),
        },
      };
      await tauriSave(updated);
      await refresh();
    } catch (e) {
      console.error('Rename failed:', e);
      await message('이름 변경에 실패했습니다.', { title: 'Error', kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const onContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      projectId,
    });
  };

  return (
    <div className="h-full flex flex-col bg-editor-surface border-r border-editor-border relative">
      <div className="h-12 px-3 flex items-center justify-between border-b border-editor-border">
        {/* Toggle & Title */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleProjectSidebar}
            className="p-1 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title="프로젝트 사이드바 접기"
          >
            {/* Sidebar Collapse Icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <div className="text-xs font-semibold text-editor-text">Projects</div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-primary-500 hover:text-primary-600 disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={loading}
            title="새로고침"
          >
            Refresh
          </button>
          <button
            type="button"
            className="text-editor-text hover:text-primary-500 transition-colors"
            onClick={() => setShowNew((v) => !v)}
            title="새 프로젝트"
          >
            {/* New Project (Edit) Icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
      </div>

      {showNew && (
        <div className="p-3 border-b border-editor-border space-y-2 bg-editor-surface z-10">
          <input
            className="w-full text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Project title"
            autoFocus
          />
          <div className="flex gap-2">
            <input
              className="w-1/2 text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
              value={form.sourceLanguage}
              onChange={(e) => setForm((p) => ({ ...p, sourceLanguage: e.target.value }))}
              placeholder="Source language"
            />
            <input
              className="w-1/2 text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
              value={form.targetLanguage}
              onChange={(e) => setForm((p) => ({ ...p, targetLanguage: e.target.value }))}
              placeholder="Target language"
            />
          </div>
          {/* Domain selection removed as per request */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="flex-1 px-3 py-1.5 rounded bg-primary-500 text-white text-xs hover:bg-primary-600"
              onClick={() => void handleNewProject()}
            >
              Create
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-editor-bg text-editor-text text-xs hover:bg-editor-border"
              onClick={() => setShowNew(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!!error && (
          <div className="px-3 py-2 text-[11px] text-red-600 border-b border-editor-border">
            {error}
          </div>
        )}
        {loading && (
          <div className="px-3 py-2 text-xs text-editor-muted">불러오는 중...</div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="px-3 py-2 text-xs text-editor-muted">프로젝트가 없습니다.</div>
        )}
        {!loading &&
          sorted.map((p) => {
            const active = selectedId === p.id;
            return (
              <div
                key={p.id}
                className={`px-3 py-2 flex items-center justify-between cursor-pointer border-l-2 ${active
                  ? 'bg-editor-bg border-primary-500'
                  : 'hover:bg-editor-bg border-transparent'
                  }`}
                onContextMenu={(e) => onContextMenu(e, p.id)}
                onClick={() => void switchProjectById(p.id)}
                title={p.title}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${active ? 'text-primary-500' : 'text-editor-text'
                    }`}>
                    {p.title}
                  </div>
                  <div className="text-[10px] text-editor-muted truncate">
                    {new Date(p.updatedAt ?? 0).toLocaleDateString()}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[120px] bg-editor-surface border border-editor-border shadow-lg rounded-md py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-editor-text hover:bg-blue-500 hover:text-white"
            onClick={() => {
              setContextMenu(null);
              void handleRename(contextMenu.projectId);
            }}
          >
            이름 변경 (Rename)
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-500 hover:text-white"
            onClick={() => {
              setContextMenu(null);
              void handleDelete(contextMenu.projectId);
            }}
          >
            삭제 (Delete)
          </button>
        </div>
      )}
    </div>
  );
}
