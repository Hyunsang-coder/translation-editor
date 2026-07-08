import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useShallow } from 'zustand/shallow';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { UnifiedSidebar } from '@/components/panels/UnifiedSidebar';
import { Toolbar } from '@/components/layout/Toolbar';
import { EditorCanvasTipTap } from '@/components/editor/EditorCanvasTipTap';
import { ToastHost } from '@/components/ui/ToastHost';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { createProject } from '@/tauri/project';

// 개발자 테스트 패널 (lazy load)
const ReviewTestPanel = lazy(() =>
  import('@/components/dev/ReviewTestPanel').then((m) => ({ default: m.ReviewTestPanel }))
);

/**
 * 메인 레이아웃 컴포넌트
 * Panel Layout: [ProjectSidebar] | [LeftSidebar] | Editor | [RightSidebar]
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

  const { t } = useTranslation();
  // 숨긴 바를 되살리는 에디터 가장자리 토글 (바 내부엔 UI가 없으므로 에디터 쪽에 노출)
  // 좌측은 hidden뿐 아니라 panels 빈 상태(렌더 null)도 되살림 대상 — 진입점 소실 방지.
  const leftInvisible = useUIStore((s) => s.leftSidebar.hidden || s.leftSidebar.panels.length === 0);
  const rightHidden = useUIStore((s) => s.rightSidebar.hidden);
  const setSidebarHiddenSide = useUIStore((s) => s.setSidebarHiddenSide);
  const openPanelOnSide = useUIStore((s) => s.openPanelOnSide);
  const openActiveChat = useUIStore((s) => s.openActiveChat);

  // 좌측 되살림: 비어 있으면 기본 고정 패널을 복구하며 열고, 아니면 단순 표시.
  const revealLeftSidebar = useCallback(() => {
    const sb = useUIStore.getState().leftSidebar;
    if (sb.panels.length === 0) {
      openPanelOnSide('left', 'settings');
    } else {
      setSidebarHiddenSide('left', false);
    }
  }, [openPanelOnSide, setSidebarHiddenSide]);

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

  return (
    <div className="flex flex-col h-screen">
      <ToastHost />

      {/* 전역 상단 헤더 밴드 — 창 전체 폭을 덮어 아래 모든 영역(목록/사이드바/에디터)이
          현재 프로젝트에 속함을 위계로 드러낸다. (프로젝트가 있을 때만) */}
      {project && <Toolbar />}

      {/* 메인 영역: [ProjectSidebar] | [LeftSidebar] | 에디터 | [RightSidebar] */}
      <main ref={zoomContainerRef} className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* 프로젝트 사이드바 (접히면 완전히 숨김) */}
        <ProjectSidebar />

        {/* 좌측 사이드바 (프로젝트 있을 때만) */}
        {project && (
          <ErrorBoundary name="LeftSidebar">
            <UnifiedSidebar side="left" />
          </ErrorBoundary>
        )}

        {/* 콘텐츠 컬럼: 에디터 */}
        <div className="flex-1 min-w-[400px] min-h-0 flex flex-col relative">
          {/* 숨긴 좌측 바 되살림 (가장자리 토글) */}
          {project && leftInvisible && (
            <button
              type="button"
              onClick={revealLeftSidebar}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-r-md bg-editor-surface/90 border border-l-0 border-editor-border text-editor-muted hover:text-editor-text hover:bg-editor-border shadow-sm transition-colors"
              title={t('sidebar.showLeft', 'Show side panel')}
              aria-label={t('sidebar.showLeft', 'Show side panel')}
              data-testid="reveal-sidebar-left"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
          {/* 숨긴 우측(채팅) 바 되살림 (가장자리 토글) */}
          {project && rightHidden && (
            <button
              type="button"
              onClick={() => openActiveChat()}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-l-md bg-editor-surface/90 border border-r-0 border-editor-border text-editor-muted hover:text-editor-text hover:bg-editor-border shadow-sm transition-colors"
              title={t('sidebar.showRight', 'Show chat panel')}
              aria-label={t('sidebar.showRight', 'Show chat panel')}
              data-testid="reveal-sidebar-right"
            >
              <PanelRightOpen size={16} />
            </button>
          )}
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
                    <h2 className="text-3xl font-bold tracking-tight">새로운 번역 프로젝트를 시작하세요</h2>
                    <p className="text-editor-muted leading-relaxed">
                      문서를 번역하고 관리할 수 있는 새로운 공간을 만들어보세요.<br />
                      기존 프로젝트가 있다면 왼쪽 사이드바에서 선택할 수 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    disabled={isCreating}
                    className="px-8 py-4 bg-primary-500 text-white rounded-xl font-bold hover:bg-primary-600 transition-all shadow-lg hover:shadow-primary-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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
