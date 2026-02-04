import { useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { SettingsSidebar } from '@/components/panels/SettingsSidebar';
import { DockedChatPanel } from '@/components/panels/DockedChatPanel';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvasTipTap } from '@/components/editor/EditorCanvasTipTap';
import { ToastHost } from '@/components/ui/ToastHost';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { createProject } from '@/tauri/project';

// 개발자 테스트 패널 (lazy load)
const ReviewTestPanel = lazy(() =>
  import('@/components/dev/ReviewTestPanel').then((m) => ({ default: m.ReviewTestPanel }))
);

/**
 * 메인 레이아웃 컴포넌트
 * Panel Layout: ProjectSidebar + SettingsSidebar + Editor + DockedChat
 */
export function MainLayout(): JSX.Element {
  const { focusMode, sidebarCollapsed, projectSidebarCollapsed, projectSidebarHidden, devTestPanelOpen, toggleDevTestPanel } = useUIStore();
  const settingsSidebarWidth = useUIStore((s) => s.settingsSidebarWidth);
  const setSettingsSidebarWidth = useUIStore((s) => s.setSettingsSidebarWidth);
  const setDevTestPanelOpen = useUIStore((s) => s.setDevTestPanelOpen);
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);

  // 반응형 레이아웃 훅 활성화
  useResponsiveLayout();

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
      // 오른쪽으로 드래그하면 너비 증가 (사이드바는 왼쪽에 있으므로)
      const delta = e.clientX - startX.current;
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

  // 개발자 테스트 패널 단축키 (Ctrl+Shift+D / Cmd+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        toggleDevTestPanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleDevTestPanel]);

  return (
    <div className="flex flex-col h-screen">
      <ToastHost />
      {/* 상단 툴바 */}
      <Toolbar />

      {/* 메인 에디터 영역 */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* 프로젝트 사이드바 */}
        {!projectSidebarHidden && (
          <aside
            className={`${projectSidebarCollapsed ? 'w-12' : 'w-[210px]'
              } border-r border-editor-border overflow-hidden transition-all duration-200`}
          >
            <ProjectSidebar />
          </aside>
        )}

        {/* Settings/Review 사이드바 (ProjectSidebar 우측, 드래그로 너비 조정 가능) */}
        {!sidebarCollapsed && project && (
          <aside
            className="shrink-0 border-r border-editor-border bg-editor-bg overflow-hidden relative"
            style={{ width: settingsSidebarWidth }}
          >
            <SettingsSidebar />
            {/* 리사이즈 핸들 (우측) */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500 transition-colors z-10"
              onMouseDown={handleResizeStart}
            />
          </aside>
        )}

        <div className="flex-1 min-w-[400px] min-h-0 relative flex">
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

          {/* 도킹된 채팅 패널 (우측 끝) */}
          {project && <DockedChatPanel />}
        </div>
      </main>

      {/* 개발자 테스트 패널 (Ctrl+Shift+D로 토글) */}
      {devTestPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-editor-surface rounded-lg shadow-xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-editor-border flex items-center justify-between bg-editor-surface">
              <h2 className="font-semibold text-editor-text">검수 테스트 패널 (Dev)</h2>
              <button
                type="button"
                onClick={() => setDevTestPanelOpen(false)}
                className="text-editor-muted hover:text-editor-text"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={<div className="p-4 text-editor-muted">Loading...</div>}>
                <ReviewTestPanel />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
