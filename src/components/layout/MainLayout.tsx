import { useCallback } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvasTipTap } from '@/components/editor/EditorCanvasTipTap';
import { ToastHost } from '@/components/ui/ToastHost';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { createProject } from '@/tauri/project';

/**
 * 메인 레이아웃 컴포넌트
 * 3컬럼 레이아웃: 원문 | 번역문 | AI 채팅
 */
export function MainLayout(): JSX.Element {
  const { focusMode, sidebarCollapsed, projectSidebarCollapsed, isPanelsSwapped } = useUIStore();
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);

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

  return (
    <div className="flex flex-col h-screen">
      {/* DiffPreviewModal 제거: 인라인 위젯에서 Keep/Discard 처리 */}
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
          {/* Resizable Panel Group */}
          <PanelGroup
            orientation="horizontal"
            className="flex-1 min-w-0 min-h-0"
            id="main-layout"
          >
          {isPanelsSwapped ? (
            // Swapped: Chat Left, Editor Right
            <>
              {/* AI 채팅 패널 (왼쪽) */}
              {!sidebarCollapsed && (
                <>
                  <Panel
                    id="chat"
                    defaultSize="40"
                    minSize="25"
                    maxSize="80"
                    className="border-r border-editor-border bg-editor-bg min-w-0"
                  >
                    {project && <ChatPanel />}
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-editor-border hover:bg-primary-500 transition-colors cursor-col-resize z-10" />
                </>
              )}

              {/* 에디터 캔버스 (TipTap) (오른쪽) */}
              <Panel id="editor" defaultSize="60" minSize="20" className="min-w-0">
                <section className="h-full flex flex-col overflow-hidden min-h-0">
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
                </section>
              </Panel>
            </>
          ) : (
            // Default: Editor Left, Chat Right
            <>
              {/* 에디터 캔버스 (TipTap) (왼쪽) */}
              <Panel id="editor" defaultSize="60" minSize="20" className="min-w-0">
                <section className="h-full flex flex-col overflow-hidden min-h-0">
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
                </section>
              </Panel>

              {/* AI 채팅 패널 (오른쪽) */}
              {!sidebarCollapsed && (
                <>
                  <PanelResizeHandle className="w-1 bg-editor-border hover:bg-primary-500 transition-colors cursor-col-resize z-10" />
                  <Panel
                    id="chat"
                    defaultSize="40"
                    minSize="25"
                    maxSize="80"
                    className="border-l border-editor-border bg-editor-bg min-w-0"
                  >
                    {project && <ChatPanel />}
                  </Panel>
                </>
              )}
            </>
          )}
          </PanelGroup>
        </div>
      </main>
    </div>
  );
}

