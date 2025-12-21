import { useUIStore } from '@/stores/uiStore';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvas } from '@/components/editor/EditorCanvas';
import { DiffPreviewModal } from '@/components/editor/DiffPreviewModal';
import { ToastHost } from '@/components/ui/ToastHost';

/**
 * 메인 레이아웃 컴포넌트
 * 3컬럼 레이아웃: 원문 | 번역문 | AI 채팅
 */
export function MainLayout(): JSX.Element {
  const { focusMode, sidebarCollapsed } = useUIStore();

  return (
    <div className="flex flex-col h-screen">
      <DiffPreviewModal />
      <ToastHost />
      {/* 상단 툴바 */}
      <Toolbar />

      {/* 메인 에디터 영역 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 에디터 캔버스 (SegmentGroup 단위 2컬럼) */}
        <section className={`${sidebarCollapsed ? 'w-[calc(100%-3rem)]' : 'w-2/3'} overflow-hidden`}>
          <EditorCanvas focusMode={focusMode} />
        </section>

        {/* AI 채팅 패널 */}
        <aside
          className={`
            ${sidebarCollapsed ? 'w-12' : focusMode ? 'w-1/3' : 'w-1/3'}
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

