import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Cog } from 'lucide-react';
import { AppSettingsModal } from '@/components/settings/AppSettingsModal';
import { listRecentProjects, deleteProject, type RecentProjectInfo } from '@/tauri/storage';
import {
  createProject,
  duplicateProject,
  loadProject as tauriLoadProject,
  saveProject as tauriSaveProject,
} from '@/tauri/project';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useResizeHandle } from '@/hooks/useResizeHandle';
import { LAYOUT } from '@/constants/layout';
import type { ProjectDomain } from '@/types';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { isTauriTestingBridgeActive } from '@/utils/tauri';

type NewProjectForm = {
  title: string;
  domain: ProjectDomain;
};

export function ProjectSidebar(): JSX.Element | null {
  const { t } = useTranslation();
  const projectSidebarCollapsed = useUIStore((s) => s.projectSidebarCollapsed);
  const projectSidebarWidth = useUIStore((s) => s.projectSidebarWidth);
  const setProjectSidebarWidth = useUIStore((s) => s.setProjectSidebarWidth);

  const { handleResizeStart } = useResizeHandle({
    width: projectSidebarWidth,
    onWidthChange: setProjectSidebarWidth,
    direction: 'right',
    minWidth: LAYOUT.PROJECT_MIN,
    maxWidth: LAYOUT.PROJECT_MAX,
  });
  const project = useProjectStore((s) => s.project);
  const error = useProjectStore((s) => s.error);
  const switchProjectById = useProjectStore((s) => s.switchProjectById);
  const loadProject = useProjectStore((s) => s.loadProject);
  const saveProject = useProjectStore((s) => s.saveProject);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const initializeProject = useProjectStore((s) => s.initializeProject);

  const [items, setItems] = useState<RecentProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewProjectForm>({
    title: 'New Project',
    domain: 'general',
  });

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [showAppSettings, setShowAppSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);

  const selectedId = project?.id ?? null;

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // 백엔드가 updated_at DESC로 정렬해 보내므로(최근 수정 우선) 그대로 사용
      const list = await listRecentProjects();
      setItems(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '프로젝트 목록 로드 실패';
      await message(msg, { title: 'Projects', kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [lastSavedAt, refresh]);

  // Close context menu on global click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingId]);

  // 접힌 상태: 완전히 숨김 (Codex 스타일). 다시 열기는 상단 헤더의 토글 버튼으로.
  if (projectSidebarCollapsed) {
    return null;
  }

  const getUniqueTitle = (baseTitle: string): string => {
    const existingTitles = new Set(items.map((p) => p.title));
    if (!existingTitles.has(baseTitle)) return baseTitle;

    let counter = 2;
    while (existingTitles.has(`${baseTitle} (${counter})`)) {
      counter++;
    }
    return `${baseTitle} (${counter})`;
  };

  const handleNewProject = async (): Promise<void> => {
    const ok = isTauriTestingBridgeActive()
      ? true
      : await confirm('새 프로젝트를 생성할까요?', {
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
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[handleNewProject] Failed to save previous project:', reason);
        await message(`기존 프로젝트 저장에 실패해 새 프로젝트 생성을 중단했습니다.\n${reason}`, {
          title: 'New Project',
          kind: 'error',
        });
        return;
      }
    }

    const baseTitle = form.title.trim() || 'New Project';
    const uniqueTitle = getUniqueTitle(baseTitle);
    try {
      const created = await createProject({
        title: uniqueTitle,
        domain: 'general',
      });

      loadProject(created);
      setShowNew(false);
      await refresh();
    } catch (e) {
      const reason = e instanceof Error ? e.message : '새 프로젝트 생성 실패';
      await message(reason, { title: 'New Project', kind: 'error' });
    }
  };

  const handleDelete = async (projectId: string): Promise<void> => {
    const ok = isTauriTestingBridgeActive()
      ? true
      : await confirm('이 프로젝트를 삭제할까요?\n(DB에서 삭제되며 복구할 수 없습니다)', {
        title: '프로젝트 삭제',
        kind: 'warning',
      });
    if (!ok) return;
    const isCurrent = selectedId === projectId;
    let nextProjectId: string | null = null;

    if (isCurrent) {
      const remaining = items.filter((p) => p.id !== projectId);
      const next = remaining[0];
      if (next?.id) {
        try {
          await switchProjectById(next.id);
          nextProjectId = next.id;
        } catch (e) {
          const reason = e instanceof Error ? e.message : '프로젝트 전환 실패';
          await message(`현재 프로젝트 저장/전환에 실패해 삭제를 중단했습니다.\n${reason}`, {
            title: '프로젝트 삭제',
            kind: 'error',
          });
          return;
        }
      }
    }

    if (isCurrent && !nextProjectId) {
      await useChatStore.getState().hydrateForProject(null);
    }

    await deleteProject(projectId);

    if (isCurrent && !nextProjectId) {
      await initializeProject();
    }

    await refresh();
  };

  const startRename = (projectId: string) => {
    const target = items.find((i) => i.id === projectId);
    if (!target) return;
    setRenameTitle(target.title);
    setRenamingId(projectId);
  };

  const submitRename = async () => {
    if (!renamingId) return;
    const projectId = renamingId;
    const newTitle = renameTitle.trim();
    const target = items.find((i) => i.id === projectId);

    setRenamingId(null); // Close input immediately

    if (!target || !newTitle || newTitle === target.title) return;

    // Optimistic Update
    setItems((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, title: newTitle, updatedAt: Date.now() }
          : p
      )
    );

    try {
      if (selectedId === projectId && project) {
        useProjectStore.setState({
          project: {
            ...project,
            metadata: { ...project.metadata, title: newTitle, updatedAt: Date.now() },
          },
          isDirty: true,
        });
        await saveProject();
      } else {
        const loaded = await tauriLoadProject(projectId);
        const updated = {
          ...loaded,
          metadata: {
            ...loaded.metadata,
            title: newTitle,
            updatedAt: Date.now(),
          },
        };
        await tauriSaveProject(updated);
      }
      await refresh();
    } catch (e) {
      console.error('Rename failed:', e);
      await message('이름 변경에 실패했습니다.', { title: 'Error', kind: 'error' });
      await refresh(); // Revert
    }
  };

  const handleDuplicate = async (projectId: string): Promise<void> => {
    try {
      await duplicateProject(projectId);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '프로젝트 복제 실패';
      await message(msg, { title: 'Error', kind: 'error' });
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
    <div className="h-full flex flex-col bg-editor-surface border-r border-editor-border relative" style={{ width: projectSidebarWidth }}>
      <div className="h-10 px-3 flex items-center border-b border-editor-border shrink-0">
        {/* Title (접기 토글은 상단 헤더 밴드로 이동) */}
        <div className="text-xs font-semibold text-editor-text flex-1">{t('projectSidebar.projects')}</div>
      </div>

      {showNew && (
        <div className="p-3 border-b border-editor-border space-y-2 bg-editor-surface z-10">
          <input
            className="w-full text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Project title"
            autoFocus
            data-testid="project-title-input"
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="flex-1 px-3 py-1.5 rounded bg-primary-500 text-white text-xs hover:bg-primary-600"
              onClick={() => void handleNewProject()}
              data-testid="project-create-button"
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
        {/* 새 프로젝트 버튼 (목록 상단) */}
        <button
          type="button"
          className="w-full px-3 py-2 flex items-center gap-2 text-editor-muted hover:text-primary-500 hover:bg-editor-bg transition-colors border-b border-editor-border"
          onClick={() => setShowNew(true)}
          title="새 프로젝트"
          data-testid="project-new-button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-xs">New</span>
        </button>

        {!!error && (
          <div className="px-3 py-2 text-[11px] text-red-600 border-b border-editor-border">
            {error}
          </div>
        )}
        {loading && (
          <div className="px-3 py-2 text-xs text-editor-muted">불러오는 중...</div>
        )}
        {!loading &&
          items.map((p) => {
            const active = selectedId === p.id;
            const isRenaming = renamingId === p.id;

            return (
              <div
                key={p.id}
                className={`px-3 py-2 flex items-center justify-between cursor-pointer border-l-2 ${active
                  ? 'bg-editor-bg border-primary-500'
                  : 'hover:bg-editor-bg border-transparent'
                  }`}
                onContextMenu={(e) => onContextMenu(e, p.id)}
                onClick={() => {
                  if (!isRenaming) {
                    void (async () => {
                      try {
                        await switchProjectById(p.id);
                      } catch (e) {
                        const reason = e instanceof Error ? e.message : String(e);
                        console.warn('[ProjectSidebar] switchProjectById failed:', reason);
                      }
                    })();
                  }
                }}
                title={p.title}
              >
                <div className="flex-1 min-w-0">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      className="w-full text-sm px-1 py-0.5 rounded border border-primary-500 bg-editor-bg text-editor-text focus:outline-none"
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      onBlur={() => void submitRename()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className={`text-xs font-medium truncate ${active ? 'text-primary-500' : 'text-editor-text'
                        }`}>
                        {p.title}
                      </div>
                      <div className="text-[10px] text-editor-muted truncate">
                        {new Date(p.updatedAt ?? 0).toLocaleDateString()}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* App Settings */}
      <div className="px-3 py-2 border-t border-editor-border shrink-0">
        <button
          type="button"
          className="w-full px-2 py-1.5 rounded-md text-left text-xs text-editor-muted hover:text-editor-text hover:bg-editor-border transition-colors flex items-center gap-2"
          onClick={() => setShowAppSettings(true)}
          data-testid="project-app-settings-button"
        >
          <Cog size={14} />
          <span>{t('projectSidebar.appSettings')}</span>
        </button>
      </div>

      {showAppSettings && (
        <AppSettingsModal onClose={() => setShowAppSettings(false)} />
      )}

      {/* Resize Handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary-500/30 active:bg-primary-500/50 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[120px] bg-editor-surface border border-editor-border shadow-lg rounded-md py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-editor-text hover:bg-blue-500 hover:text-white"
            onClick={() => {
              const pid = contextMenu.projectId;
              setContextMenu(null);
              void handleDuplicate(pid);
            }}
          >
            복제 (Duplicate)
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-editor-text hover:bg-blue-500 hover:text-white"
            onClick={() => {
              const pid = contextMenu.projectId;
              setContextMenu(null);
              startRename(pid);
            }}
          >
            이름 변경 (Rename)
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-500 hover:text-white"
            onClick={() => {
              const pid = contextMenu.projectId;
              setContextMenu(null);
              void handleDelete(pid);
            }}
          >
            삭제 (Delete)
          </button>
        </div>
      )}
    </div>
  );
}
