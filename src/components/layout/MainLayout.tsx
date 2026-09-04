import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useShallow } from 'zustand/shallow';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { UnifiedSidebar } from '@/components/panels/UnifiedSidebar';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvasTipTap } from '@/components/editor/EditorCanvasTipTap';
import { ToastHost } from '@/components/ui/ToastHost';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Modal } from '@/components/ui/Modal';
import { createProject } from '@/tauri/project';
import { FloatingChatPanel } from '@/components/chat/FloatingChatPanel';

// 개발자 테스트 패널 (lazy load)
const ReviewTestPanel = lazy(() =>
  import('@/components/dev/ReviewTestPanel').then((m) => ({ default: m.ReviewTestPanel }))
);

/**
 * 메인 레이아웃 컴포넌트
 * Panel Layout: [LeftSidebar] | Editor | [RightSidebar]
 * 각 패널은 자체적으로 접힌 상태(아이콘만)와 펼친 상태를 가짐
 */
export function MainLayout(): JSX.Element {
  const { devTestPanelOpen, toggleDevTestPanel } = useUIStore(
    useShallow((s) => ({
      devTestPanelOpen: s.devTestPanelOpen,
      toggleDevTestPanel: s.toggleDevTestPanel,
    }))
  );
  const setDevTestPanelOpen = useUIStore((s) => s.setDevTestPanelOpen);
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);

  // 반응형 레이아웃 훅 활성화
  useResponsiveLayout();

  const [isCreating, setIsCreating] = useState(false);
  const isCreatingRef = useRef(false);

  const handleCreateProject = useCallback(async () => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setIsCreating(true);
    try {
      const created = await createProject({
        title: 'New Project',
        domain: 'general',
      });
      loadProject(created);
    } catch (e) {
      console.error('Failed to create project:', e);
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  }, [loadProject]);

  // App-wide Ctrl/Cmd + Scroll zoom
  const zoomContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el) return;

    // Apply initial zoom + subscribe for updates (zoom-only guard)
    el.style.setProperty('zoom', String(useUIStore.getState().editorZoom));
    let prevZoom = useUIStore.getState().editorZoom;
    const unsub = useUIStore.subscribe((state) => {
      if (state.editorZoom === prevZoom) return;
      prevZoom = state.editorZoom;
      el.style.setProperty('zoom', String(state.editorZoom));
    });

    const handleWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      useUIStore.getState().adjustEditorZoom(e.deltaY < 0 ? 0.1 : -0.1);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      unsub();
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

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

  // AI 워크플로 단축키 (Cmd/Ctrl + T/R/P) — 웹 모드 경로.
  // Tauri에서는 네이티브 AI 메뉴의 accelerator가 웹뷰보다 먼저 키를 가져가
  // `App.tsx`의 tauri-menu 핸들러가 같은 트리거를 올린다 (여기까지 오지 않는다).
  // TipTap이 포커스를 가진 상태에서도 동작해야 하므로 document 레벨에 등록한다.
  // project 객체는 문서 편집마다 새로 만들어지므로 존재 여부만 의존한다(리스너 재등록 방지).
  const hasProject = project !== null;
  useEffect(() => {
    if (!hasProject) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key !== 't' && key !== 'r' && key !== 'p') return;
      e.preventDefault();
      const ui = useUIStore.getState();
      if (key === 't') ui.triggerTranslate();
      else if (key === 'r') ui.triggerReview();
      else ui.triggerPolish();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasProject]);

  return (
    <div className="flex flex-col h-screen">
      <ToastHost />

      {/* 전역 상단 헤더 밴드 — 창 전체 폭을 덮어 아래 모든 영역이 현재 프로젝트에
          속함을 위계로 드러낸다. 프로젝트가 없을 때도 렌더한다 — 프로젝트 목록과
          앱 설정 진입점(ProjectPicker)이 여기에만 있기 때문. */}
      <Toolbar />

      {/* 메인 영역: [LeftSidebar] | 에디터 | [RightSidebar] */}
      <main ref={zoomContainerRef} className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* 좌측 사이드바 (프로젝트 있을 때만) */}
        {project && (
          <ErrorBoundary name="LeftSidebar">
            <UnifiedSidebar side="left" />
          </ErrorBoundary>
        )}

        {/* 콘텐츠 컬럼: 에디터 */}
        <div className="flex-1 min-w-[400px] min-h-0 flex flex-col">
          {/* 에디터 캔버스 (TipTap) */}
          <div className="flex-1 min-h-0">
            {project ? (
              <ErrorBoundary name="Editor">
                <EditorCanvasTipTap />
              </ErrorBoundary>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-editor-bg text-editor-text p-8">
                {/* Empty State Content */}
                <div className="max-w-md text-center space-y-8">
                  <div className="space-y-4">
                    <h2 className="text-[30px] font-semibold tracking-[-0.022em] text-editor-text">새로운 번역 프로젝트를 시작하세요</h2>
                    <p className="text-editor-muted leading-relaxed">
                      문서를 번역하고 관리할 수 있는 새로운 공간을 만들어보세요.<br />
                      기존 프로젝트가 있다면 상단의 프로젝트 메뉴에서 선택할 수 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    disabled={isCreating}
                    className="h-[44px] px-6 bg-primary-fill text-white rounded-md text-sm font-semibold hover:bg-primary-fill-hover active:scale-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreating ? '생성 중...' : '새 프로젝트 시작하기'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 우측 사이드바 (프로젝트 있을 때만) */}
        {project && (
          <ErrorBoundary name="RightSidebar">
            <UnifiedSidebar side="right" />
          </ErrorBoundary>
        )}

        {project && (
          <ErrorBoundary name="FloatingChatPanel">
            <FloatingChatPanel />
          </ErrorBoundary>
        )}

      </main>

      {/* 개발자 테스트 패널 (Ctrl+Shift+D로 토글) */}
      {devTestPanelOpen && (
        <Modal
          open
          onClose={() => setDevTestPanelOpen(false)}
          labelId="review-test-panel-title"
          className="bg-black/50 p-4"
          closeOnOverlay={false}
        >
          <div className="bg-editor-surface rounded-lg shadow-xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-editor-hairline flex items-center justify-between bg-editor-surface">
              <h2 id="review-test-panel-title" className="font-semibold text-editor-text">검수 테스트 패널 (Dev)</h2>
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
        </Modal>
      )}
    </div>
  );
}
