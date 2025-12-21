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
  const isLoading = useProjectStore((s) => s.isLoading);
  const error = useProjectStore((s) => s.error);
  const switchProjectById = useProjectStore((s) => s.switchProjectById);
  const loadProject = useProjectStore((s) => s.loadProject);

  const [items, setItems] = useState<RecentProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewProjectForm>({
    title: 'New Project',
    sourceLanguage: 'English',
    targetLanguage: 'Korean',
    domain: 'general',
  });

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

  if (projectSidebarCollapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4">
        <button
          type="button"
          onClick={toggleProjectSidebar}
          className="p-2 rounded-md hover:bg-editor-border transition-colors"
          title="프로젝트 사이드바 열기"
        >
          📁
        </button>
      </div>
    );
  }

  const handleNewProject = async (): Promise<void> => {
    const ok = await confirm('새 프로젝트를 생성할까요?', {
      title: 'New Project',
      kind: 'info',
      buttons: 'YesNo',
    });
    if (!ok) return;

    const created = await createProject({
      title: form.title.trim() || 'New Project',
      sourceLanguage: form.sourceLanguage.trim() || 'English',
      targetLanguage: form.targetLanguage.trim() || 'Korean',
      domain: form.domain,
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
      buttons: 'YesNo',
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

  return (
    <div className="h-full flex flex-col bg-editor-surface">
      <div className="h-12 px-3 flex items-center justify-between border-b border-editor-border">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleProjectSidebar}
            className="p-1 rounded hover:bg-editor-border transition-colors text-editor-muted"
            title="프로젝트 사이드바 접기"
          >
            ◀
          </button>
          <div className="text-xs font-semibold text-editor-text">Projects</div>
        </div>
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
            className="text-xs text-primary-500 hover:text-primary-600"
            onClick={() => setShowNew((v) => !v)}
            title="새 프로젝트"
          >
            + New
          </button>
        </div>
      </div>

      {showNew && (
        <div className="p-3 border-b border-editor-border space-y-2">
          <input
            className="w-full text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Project title"
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
          <select
            className="w-full text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
            value={form.domain}
            onChange={(e) => setForm((p) => ({ ...p, domain: e.target.value as ProjectDomain }))}
            title="Domain"
          >
            <option value="general">general</option>
            <option value="game">game</option>
            <option value="software">software</option>
            <option value="marketing">marketing</option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 px-3 py-1.5 rounded bg-primary-500 text-white text-sm hover:bg-primary-600"
              onClick={() => void handleNewProject()}
            >
              Create
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-editor-bg text-editor-text text-sm hover:bg-editor-border"
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
                className={`px-2 py-1 flex items-stretch gap-1 ${
                  active ? 'bg-editor-bg' : 'hover:bg-editor-bg'
                }`}
                title={p.id}
              >
                <button
                  type="button"
                  className="flex-1 text-left px-1.5 py-1 rounded transition-colors"
                  disabled={isLoading}
                  onClick={() => void switchProjectById(p.id)}
                >
                  <div className="text-sm text-editor-text truncate">{p.title}</div>
                </button>
                <button
                  type="button"
                  className="px-2 text-sm text-editor-muted hover:text-red-600 transition-colors disabled:opacity-50"
                  onClick={() => void handleDelete(p.id)}
                  disabled={isLoading}
                  title="삭제"
                >
                  🗑
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}


