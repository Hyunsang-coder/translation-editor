import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Search, MessageSquare } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { SettingsContent } from '@/components/panels/SettingsContent';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { ChatContent } from '@/components/chat/ChatContent';
import { useResizeHandle } from '@/hooks/useResizeHandle';
import type { SidebarSide, PanelType, PanelDragData } from '@/types';
import { isChatPanel, getChatSessionId } from '@/types';
import { confirm } from '@tauri-apps/plugin-dialog';

interface UnifiedSidebarProps {
  side: SidebarSide;
}

const FIXED_PANEL_META: Record<'settings' | 'review', { icon: typeof Settings; labelKey: string }> = {
  settings: { icon: Settings, labelKey: 'chat.settings' },
  review:   { icon: Search, labelKey: 'review.title' },
};

function getPanelIcon(panel: PanelType): typeof Settings {
  if (isChatPanel(panel)) return MessageSquare;
  return FIXED_PANEL_META[panel as 'settings' | 'review']?.icon ?? Settings;
}

function getPanelLabel(panel: PanelType, t: (key: string) => string, sessions: { id: string; name: string }[]): string {
  if (isChatPanel(panel)) {
    const sessionId = getChatSessionId(panel);
    const session = sessions.find((s) => s.id === sessionId);
    return session?.name ?? t('chat.title');
  }
  const meta = FIXED_PANEL_META[panel as 'settings' | 'review'];
  return meta ? t(meta.labelKey) : panel;
}

const DRAG_MIME = 'text/x-panel-dock';

/**
 * 모듈 레벨 드래그 상태 — 좌/우 사이드바 인스턴스 간 공유
 * React state로는 별도 인스턴스라 서로 안 보이므로 모듈 변수 사용
 */
let activeDrag: PanelDragData | null = null;

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  panel: PanelType;
}

/**
 * 통합 사이드바 컴포넌트 (Docking Model)
 * panels 배열에 도킹된 패널만 탭으로 표시
 * HTML5 DnD로 패널 이동, 우클릭 컨텍스트 메뉴 지원
 */
export function UnifiedSidebar({ side }: UnifiedSidebarProps): JSX.Element {
  const { t } = useTranslation();
  const sidebarKey = side === 'left' ? 'leftSidebar' : 'rightSidebar';

  // 개별 primitive 선택자로 안정적 구독 (useShallow 무한 루프 방지)
  const collapsed = useUIStore((s) => s[sidebarKey].collapsed);
  const panels = useUIStore((s) => s[sidebarKey].panels);
  const activePanel = useUIStore((s) => s[sidebarKey].activePanel);
  const width = useUIStore((s) => s[sidebarKey].width);
  const toggleSidebarCollapse = useUIStore((s) => s.toggleSidebarCollapse);
  const setActivePanel_side = useUIStore((s) => s.setActivePanel_side);
  const movePanel = useUIStore((s) => s.movePanel);
  const setSidebarWidthSide = useUIStore((s) => s.setSidebarWidthSide);

  // chatStore에서 세션 목록 구독 (이름 표시용) — sessions 배열 자체를 구독하고 useMemo로 파생
  const sessions = useChatStore((s) => s.sessions);
  const chatSessions = useMemo(() => sessions.map((ses) => ({ id: ses.id, name: ses.name })), [sessions]);
  const isSessionLimitReached = useChatStore((s) => s.isSessionLimitReached);

  const onWidthChange = useCallback(
    (w: number) => setSidebarWidthSide(side, w),
    [side, setSidebarWidthSide],
  );

  const { handleResizeStart } = useResizeHandle({
    width,
    onWidthChange,
    direction: side === 'left' ? 'right' : 'left',
  });

  const borderClass = side === 'left' ? 'border-r' : 'border-l';
  const resizeHandlePosition = side === 'left' ? 'right-0' : 'left-0';

  // --- DnD state ---
  const [dragOverActive, setDragOverActive] = useState(false);
  const [draggingPanel, setDraggingPanel] = useState<PanelType | null>(null);

  const handleDragStart = useCallback((panel: PanelType, e: React.DragEvent) => {
    const data: PanelDragData = { panelType: panel, sourceSide: side };
    activeDrag = data;
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingPanel(panel);
  }, [side]);

  const handleDragEnd = useCallback(() => {
    activeDrag = null;
    setDraggingPanel(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!activeDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && target.contains(related)) return;
    setDragOverActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverActive(false);
    const data = activeDrag;
    activeDrag = null;
    if (!data) return;
    if (data.sourceSide !== side) {
      movePanel(data.panelType, data.sourceSide, side);
    }
  }, [side, movePanel]);

  // --- Context menu ---
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, panel: 'settings' });
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((panel: PanelType, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, panel });
  }, []);

  useEffect(() => {
    if (!ctxMenu.visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu((prev) => ({ ...prev, visible: false }));
    };
    const onClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [ctxMenu.visible]);

  const otherSide: SidebarSide = side === 'left' ? 'right' : 'left';

  const handleMoveToOtherSide = useCallback(() => {
    movePanel(ctxMenu.panel, side, otherSide);
    setCtxMenu((prev) => ({ ...prev, visible: false }));
  }, [ctxMenu.panel, side, otherSide, movePanel]);

  // Chat 탭 닫기 (세션 삭제)
  const handleCloseChatTab = useCallback(async (panel: PanelType, e: React.MouseEvent) => {
    e.stopPropagation();
    const sessionId = getChatSessionId(panel);
    if (!sessionId) return;
    const ok = await confirm(t('chat.deleteSessionConfirm'), { title: t('chat.deleteSessionTitle'), kind: 'warning' });
    if (ok) {
      useChatStore.getState().deleteSession(sessionId);
    }
  }, [t]);

  // + 버튼: 새 채팅 세션 추가
  const handleAddChatSession = useCallback(() => {
    const store = useChatStore.getState();
    if (store.isSessionLimitReached()) return;
    store.createSession();
  }, []);

  // 채팅 탭이 있는지 확인 (+ 버튼 표시 여부)
  const hasChatPanels = panels.some(isChatPanel);

  // --- Empty sidebar: thin drop zone ---
  if (panels.length === 0) {
    return (
      <div
        className={`w-4 h-full ${borderClass} border-editor-border border-dashed bg-editor-surface/30 transition-colors ${dragOverActive ? 'ring-2 ring-primary-500/30 bg-primary-50/10' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
    );
  }

  // --- Collapsed: icons only ---
  if (collapsed) {
    return (
      <div
        className={`w-12 h-full flex flex-col items-center py-2 gap-1 bg-editor-surface ${borderClass} border-editor-border ${dragOverActive ? 'ring-2 ring-primary-500/30' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {panels.map((panel) => {
          const Icon = getPanelIcon(panel);
          const label = getPanelLabel(panel, t, chatSessions);
          return (
            <button
              key={panel}
              type="button"
              onClick={() => {
                toggleSidebarCollapse(side);
                setActivePanel_side(side, panel);
              }}
              className="p-2.5 rounded-lg hover:bg-editor-border transition-colors text-editor-muted hover:text-editor-text"
              title={label}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>
    );
  }

  // --- Render active content ---
  const renderContent = () => {
    if (!activePanel) return null;
    if (activePanel === 'settings') return <SettingsContent />;
    if (activePanel === 'review') return <ReviewPanel />;
    if (isChatPanel(activePanel)) {
      const sessionId = getChatSessionId(activePanel);
      return sessionId ? <ChatContent side={side} sessionId={sessionId} /> : null;
    }
    return null;
  };

  return (
    <aside
      className={`shrink-0 ${borderClass} border-editor-border bg-editor-bg overflow-hidden relative flex flex-col ${dragOverActive ? 'ring-2 ring-primary-500/30' : ''}`}
      style={{ width }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Tab Header */}
      <div className="h-10 border-b border-editor-border flex items-center bg-editor-bg select-none shrink-0">
        {/* Collapse button */}
        <button
          type="button"
          onClick={() => toggleSidebarCollapse(side)}
          className="p-2 hover:bg-editor-border transition-colors text-editor-muted"
          title={t('common.collapse', 'Collapse')}
        >
          {(() => {
            const Icon = activePanel ? getPanelIcon(activePanel) : Settings;
            return <Icon size={18} />;
          })()}
        </button>

        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
          {panels.map((panel) => {
            const label = getPanelLabel(panel, t, chatSessions);
            const isChat = isChatPanel(panel);
            return (
              <div
                key={panel}
                draggable
                onDragStart={(e) => handleDragStart(panel, e)}
                onDragEnd={handleDragEnd}
                onClick={() => setActivePanel_side(side, panel)}
                onContextMenu={(e) => handleContextMenu(panel, e)}
                className={`
                  group relative h-10 px-3 flex items-center gap-1.5 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[60px] max-w-[140px]
                  ${activePanel === panel
                    ? 'bg-editor-surface text-primary-500 border-b-2 border-b-primary-500'
                    : 'text-editor-muted hover:bg-editor-surface hover:text-editor-text'
                  }
                  ${draggingPanel === panel ? 'opacity-50' : ''}
                `}
                title={label}
              >
                <span className="truncate flex-1">{label}</span>
                {isChat && (
                  <button
                    className={`
                      opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-editor-border/50 text-[10px] leading-none
                      ${activePanel === panel ? 'opacity-100' : ''}
                    `}
                    onClick={(e) => void handleCloseChatTab(panel, e)}
                    title={t('common.close')}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {/* + 버튼: 새 채팅 추가 */}
          {hasChatPanels && !isSessionLimitReached() && (
            <button
              type="button"
              onClick={handleAddChatSession}
              className="h-10 px-3 flex items-center justify-center text-editor-muted hover:text-primary-500 hover:bg-editor-surface transition-colors border-r border-editor-border"
              title={t('chat.newChat')}
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {renderContent()}
      </div>

      {/* Resize handle */}
      <div
        className={`absolute ${resizeHandlePosition} top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500 transition-colors z-10`}
        onMouseDown={handleResizeStart}
      />

      {/* Context menu */}
      {ctxMenu.visible && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[100] w-48 rounded-lg border border-editor-border bg-editor-surface shadow-lg overflow-hidden"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            type="button"
            className="w-full px-4 py-2.5 text-left text-sm text-editor-text hover:bg-editor-border/60 transition-colors"
            onClick={handleMoveToOtherSide}
          >
            {otherSide === 'right' ? t('chat.moveToRight') : t('chat.moveToLeft')}
          </button>
        </div>
      )}
    </aside>
  );
}
