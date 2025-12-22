import { useUIStore } from '@/stores/uiStore';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvas } from '@/components/editor/EditorCanvas';
import { DiffPreviewModal } from '@/components/editor/DiffPreviewModal';
import { ToastHost } from '@/components/ui/ToastHost';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';

/**
 * 메인 레이아웃 컴포넌트
 * 3컬럼 레이아웃: 원문 | 번역문 | AI 채팅
 */
export function MainLayout(): JSX.Element {
  const { focusMode, sidebarCollapsed, projectSidebarCollapsed } = useUIStore();

  return (
    <div className="flex flex-col h-screen">
      <DiffPreviewModal />
      <ToastHost />
      {/* 상단 툴바 */}
      <Toolbar />

      {/* 메인 에디터 영역 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 프로젝트 사이드바 */}
        <aside
          className={`${projectSidebarCollapsed ? 'w-12' : 'w-64'
            } border-r border-editor-border overflow-hidden transition-all duration-200`}
        >
          <ProjectSidebar />
        </aside>

        {/* 에디터 캔버스 */}
        <section className="flex-1 overflow-hidden">
          <EditorCanvas focusMode={focusMode} />
        </section>

        {/* AI 채팅 패널 */}
        <aside
          className={`
            ${sidebarCollapsed ? 'w-12' : 'w-[420px]'}
            border-l border-editor-border
            transition-all duration-300
            overflow-hidden
          `}
        >
          <ChatPanel />
        </aside>
      </main>
    </div>
  );
}

