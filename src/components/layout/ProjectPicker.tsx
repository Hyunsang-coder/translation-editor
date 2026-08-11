import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, MoreHorizontal, Plus } from 'lucide-react';
import { listRecentProjects, deleteProject, type RecentProjectInfo } from '@/tauri/storage';
import {
  createProject,
  duplicateProject,
  loadProject as tauriLoadProject,
  saveProject as tauriSaveProject,
} from '@/tauri/project';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { isTauriTestingBridgeActive } from '@/utils/tauri';

/**
 * 상단 툴바의 프로젝트 선택 드롭다운.
 *
 * 이전에는 좌측 고정 사이드바(`ProjectSidebar`)였다. 폭 160–300px를 상시 점유해
 * 에디터 좌우 공간을 잠식했고, 사이드바 토글 아이콘이 좌/우 패널 토글 아이콘과
 * 겹쳐 보였다. 프로젝트 전환은 자주 하는 동작이 아니므로 드롭다운이 맞다.
 *
 * 목록/생성/복제/이름변경/삭제는 사이드바에서 그대로 옮겨왔다. 앱 설정은 여기 있다가
 * 툴바 우측 기어로 옮겼다 — 앱 전역 설정이 프로젝트 선택 하위에 있는 건 위계가 어긋난다.
 */
export function ProjectPicker(): JSX.Element {
  const { t } = useTranslation();

  const project = useProjectStore((s) => s.project);
  const error = useProjectStore((s) => s.error);
  const switchProjectById = useProjectStore((s) => s.switchProjectById);
  const loadProject = useProjectStore((s) => s.loadProject);
  const saveProject = useProjectStore((s) => s.saveProject);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const initializeProject = useProjectStore((s) => s.initializeProject);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('New Project');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [actionMenu, setActionMenu] = useState<{
    top: number;
    left: number;
    projectId: string;
    projectTitle: string;
  } | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedId = project?.id ?? null;

  const updateMenuPosition = useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 300;
    const viewportPadding = 8;
    setMenuPosition({
      top: rect.bottom + 4,
      left: Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)
      ),
    });
  }, []);

  const openPicker = useCallback((): void => {
    setActionMenu(null);
    updateMenuPosition();
    setOpen(true);
  }, [updateMenuPosition]);

  const closePicker = useCallback((): void => {
    setActionMenu(null);
    setOpen(false);
  }, []);

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

  // 네이티브 View 메뉴의 "프로젝트" 항목에서 열기
  useEffect(() => {
    const handler = () => openPicker();
    window.addEventListener('app:open-project-picker', handler);
    return () => window.removeEventListener('app:open-project-picker', handler);
  }, [openPicker]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onResize = (): void => {
      setActionMenu(null);
      updateMenuPosition();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, updateMenuPosition]);

  // 바깥 클릭 / ESC로 닫기 (행 액션 메뉴가 열려 있으면 그것만 먼저 닫는다)
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest('[data-project-picker-layer], [data-project-action-menu]')
      ) return;
      closePicker();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (actionMenu) {
        setActionMenu(null);
        return;
      }
      if (renamingId) return; // 입력 자체의 ESC 처리를 방해하지 않는다
      closePicker();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, actionMenu, renamingId, closePicker]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingId]);

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

    const baseTitle = newTitle.trim() || 'New Project';
    const uniqueTitle = getUniqueTitle(baseTitle);
    try {
      const created = await createProject({
        title: uniqueTitle,
        domain: 'general',
      });

      loadProject(created);
      setShowNew(false);
      closePicker();
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
    const nextTitle = renameTitle.trim();
    const target = items.find((i) => i.id === projectId);

    setRenamingId(null); // Close input immediately

    if (!target || !nextTitle || nextTitle === target.title) return;

    // Optimistic Update
    setItems((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, title: nextTitle, updatedAt: Date.now() }
          : p
      )
    );

    try {
      if (selectedId === projectId && project) {
        useProjectStore.setState({
          project: {
            ...project,
            metadata: { ...project.metadata, title: nextTitle, updatedAt: Date.now() },
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
            title: nextTitle,
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

  const handleSelect = (projectId: string): void => {
    closePicker();
    void (async () => {
      try {
        await switchProjectById(projectId);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[ProjectPicker] switchProjectById failed:', reason);
      }
    })();
  };

  const toggleActionMenu = (
    projectId: string,
    projectTitle: string,
    trigger: HTMLButtonElement,
  ): void => {
    if (actionMenu?.projectId === projectId) {
      setActionMenu(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 144;
    const menuHeight = 112;
    const viewportPadding = 8;
    const preferredTop = rect.bottom + 4;
    const top = preferredTop + menuHeight <= window.innerHeight - viewportPadding
      ? preferredTop
      : Math.max(viewportPadding, rect.top - menuHeight - 4);
    const left = Math.max(
      viewportPadding,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding),
    );

    setActionMenu({ top, left, projectId, projectTitle });
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            closePicker();
          } else {
            openPicker();
          }
        }}
        className="h-[34px] max-w-[280px] px-2 flex items-center gap-1.5 rounded-md hover:bg-editor-border transition-colors focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
        title={t('projectSidebar.projects')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="project-picker-trigger"
      >
        <span className="text-sm font-extrabold text-editor-text truncate">
          {project?.metadata.title ?? t('common.untitledProject')}
        </span>
        <ChevronDown size={14} className="shrink-0 text-editor-muted" />
      </button>

      {/* Editor popovers use z-index <= 82; application modals start at 200. */}
      {open && menuPosition && createPortal(
        <div
          role="menu"
          data-project-picker-layer
          className="fixed z-[90] w-[300px] rounded-lg border border-editor-border bg-editor-surface shadow-lg overflow-hidden flex flex-col"
          style={{ top: menuPosition.top, left: menuPosition.left }}
          data-testid="project-picker-menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          {showNew ? (
            <div className="p-3 border-b border-editor-hairline space-y-2">
              <input
                className="w-full text-sm px-2 py-1.5 rounded border border-editor-border bg-editor-bg text-editor-text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Project title"
                autoFocus
                data-testid="project-title-input"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 px-3 py-1.5 rounded bg-primary-fill text-white text-xs hover:bg-primary-fill-hover"
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
          ) : (
            <button
              type="button"
              className="w-full px-3 py-2 flex items-center gap-2 text-editor-muted hover:text-primary-500 hover:bg-editor-bg transition-colors border-b border-editor-hairline"
              onClick={() => {
                setActionMenu(null);
                setShowNew(true);
              }}
              title="새 프로젝트"
              data-testid="project-new-button"
            >
              <Plus size={14} />
              <span className="text-xs">New</span>
            </button>
          )}

          <div
            className="flex-1 max-h-[320px] overflow-y-auto"
            onScroll={() => setActionMenu(null)}
          >
            {!!error && (
              <div className="px-3 py-2 text-[11px] text-severity-critical border-b border-editor-hairline">
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
                    role="none"
                    data-project-row
                    data-testid={`project-row-${p.id}`}
                    className={`group px-2 py-2 flex items-center gap-1 border-l-2 ${active
                      ? 'bg-editor-bg border-primary-500'
                      : 'hover:bg-editor-bg border-transparent'
                      }`}
                  >
                    {isRenaming ? (
                      <div className="flex-1 min-w-0 px-1">
                        <input
                          ref={renameInputRef}
                          className="w-full text-sm px-1 py-0.5 rounded border border-primary-500 bg-editor-bg text-editor-text focus:outline-none"
                          value={renameTitle}
                          onChange={(e) => setRenameTitle(e.target.value)}
                          onBlur={() => void submitRename()}
                          aria-label={t('projectSidebar.renameProject')}
                          data-testid={`project-rename-input-${p.id}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void submitRename();
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        data-project-select
                        data-testid={`project-select-${p.id}`}
                        className="min-w-0 flex-1 cursor-pointer rounded-sm px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                        onClick={() => handleSelect(p.id)}
                        title={p.title}
                      >
                        <div className={`text-xs font-medium truncate ${active ? 'text-primary-500' : 'text-editor-text'
                          }`}>
                          {p.title}
                        </div>
                        <div className="text-[10px] text-editor-muted truncate">
                          {new Date(p.updatedAt ?? 0).toLocaleDateString()}
                        </div>
                      </button>
                    )}
                    {!isRenaming && (
                      <button
                        type="button"
                        role="menuitem"
                        data-project-action-trigger
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-editor-muted transition-colors hover:bg-editor-border hover:text-editor-text focus-visible:outline-2 focus-visible:outline-primary-focus ${
                          actionMenu?.projectId === p.id
                            ? 'bg-editor-border text-editor-text'
                            : 'opacity-70 group-hover:opacity-100 focus-visible:opacity-100'
                        }`}
                        aria-label={t('projectSidebar.projectActions', { title: p.title })}
                        aria-haspopup="menu"
                        aria-expanded={actionMenu?.projectId === p.id}
                        data-testid={`project-actions-${p.id}`}
                        onClick={(e) => {
                          toggleActionMenu(p.id, p.title, e.currentTarget);
                        }}
                      >
                        <MoreHorizontal size={16} className="pointer-events-none" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>,
        document.body
      )}

      {open && actionMenu && createPortal(
        <div
          role="menu"
          aria-label={t('projectSidebar.projectActions', { title: actionMenu.projectTitle })}
          data-project-action-menu
          data-testid="project-action-menu"
          className="fixed z-[100] min-w-[144px] rounded-lg border border-editor-border bg-editor-surface py-1 shadow-lg"
          style={{ top: actionMenu.top, left: actionMenu.left }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="project-action-duplicate"
            className="w-full px-3 py-1.5 text-left text-xs text-editor-text hover:bg-editor-border"
            onClick={() => {
              const pid = actionMenu.projectId;
              setActionMenu(null);
              void handleDuplicate(pid);
            }}
          >
            {t('projectSidebar.duplicateProject')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="project-action-rename"
            className="w-full px-3 py-1.5 text-left text-xs text-editor-text hover:bg-editor-border"
            onClick={() => {
              const pid = actionMenu.projectId;
              setActionMenu(null);
              startRename(pid);
            }}
          >
            {t('projectSidebar.renameProject')}
          </button>
          <div className="my-1 border-t border-editor-hairline" />
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-1.5 text-left text-xs text-severity-critical hover:bg-severity-critical/10"
            onClick={() => {
              const pid = actionMenu.projectId;
              setActionMenu(null);
              void handleDelete(pid);
            }}
          >
            {t('projectSidebar.deleteProject')}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
