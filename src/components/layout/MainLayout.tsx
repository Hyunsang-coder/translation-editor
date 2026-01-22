import { useCallback, useRef, useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { SettingsSidebar } from '@/components/panels/SettingsSidebar';
import { FloatingChatPanel } from '@/components/panels/FloatingChatPanel';
import { FloatingChatButton } from '@/components/ui/FloatingChatButton';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvasTipTap } from '@/components/editor/EditorCanvasTipTap';
import { ToastHost } from '@/components/ui/ToastHost';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { createProject } from '@/tauri/project';

/**
 * 메인 레이아웃 컴포넌트
 * Hybrid Panel Layout: Editor + Settings Sidebar (고정) + Floating Chat
 */
export function MainLayout(): JSX.Element {
  const { focusMode, sidebarCollapsed, projectSidebarCollapsed } = useUIStore();
  const settingsSidebarWidth = useUIStore((s) => s.settingsSidebarWidth);
  const setSettingsSidebarWidth = useUIStore((s) => s.setSettingsSidebarWidth);
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleCreateProject = useCallback(async () => {
    try {
      const created = await createProject({
        title: 'New Project',
        domain: 'general',
      });
      loadProject(created);
    } catch (e) {
      console.error('Failed to create project:', e);
    }
  }, [loadProject]);

  // 사이드바 리사이즈 핸들러
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = settingsSidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [settingsSidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // 왼쪽으로 드래그하면 너비 증가 (사이드바는 오른쪽에 있으므로)
      const delta = startX.current - e.clientX;
      const newWidth = startWidth.current + delta;
      setSettingsSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setSettingsSidebarWidth]);

  return (
    <div className="flex flex-col h-screen">
      <ToastHost />
      {/* 상단 툴바 */}
      <Toolbar />

      {/* 메인 에디터 영역 */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* 프로젝트 사이드바 */}
        <aside
          className={`${projectSidebarCollapsed ? 'w-12' : 'w-64'
            } border-r border-editor-border overflow-hidden transition-all duration-200`}
        >
          <ProjectSidebar />
        </aside>

        <div className="flex-1 min-w-0 min-h-0 relative flex">
          {/* 에디터 캔버스 (TipTap) */}
          <div className="flex-1 min-w-0 min-h-0">
            {project ? (
              <EditorCanvasTipTap focusMode={focusMode} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-editor-bg text-editor-text p-8">
                {/* Empty State Content */}
                <div className="max-w-md text-center space-y-8">
                  <div className="space-y-4">
                    <h2 className="text-3xl font-bold tracking-tight">새로운 번역 프로젝트를 시작하세요</h2>
                    <p className="text-editor-muted leading-relaxed">
                      문서를 번역하고 관리할 수 있는 새로운 공간을 만들어보세요.<br />
                      기존 프로젝트가 있다면 왼쪽 사이드바에서 선택할 수 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    className="px-8 py-4 bg-primary-500 text-white rounded-xl font-bold hover:bg-primary-600 transition-all shadow-lg hover:shadow-primary-500/20 active:scale-95"
                  >
                    새 프로젝트 시작하기
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Settings/Review 사이드바 (드래그로 너비 조정 가능) */}
          {!sidebarCollapsed && project && (
            <aside
              className="shrink-0 border-l border-editor-border bg-editor-bg overflow-hidden relative"
              style={{ width: settingsSidebarWidth }}
            >
              {/* 리사이즈 핸들 */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500 transition-colors z-10"
                onMouseDown={handleResizeStart}
              />
              <SettingsSidebar />
            </aside>
          )}
        </div>
      </main>

      {/* 플로팅 컴포넌트 (PanelGroup 외부) */}
      {project && (
        <>
          <FloatingChatPanel />
          <FloatingChatButton />
        </>
      )}
    </div>
  );
}
