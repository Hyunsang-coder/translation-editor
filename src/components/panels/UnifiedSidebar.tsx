import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Search, MessageSquare, StickyNote } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { MAX_CHAT_SESSIONS } from '@/stores/chatStore.types';
import { resolveLayout, getMaxSidebarWidth } from '@/stores/layoutResolver';
import { SettingsContent } from '@/components/panels/SettingsContent';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { CommentListPanel } from '@/components/comment/CommentListPanel';
import { ChatContent } from '@/components/chat/ChatContent';
import { useResizeHandle } from '@/hooks/useResizeHandle';
import { usePanelDrag } from '@/hooks/usePanelDrag';
import { LAYOUT } from '@/constants/layout';
import type { SidebarSide, PanelType } from '@/types';
import { isChatPanel, getChatSessionId, chatPanelId } from '@/types';
import { confirm } from '@tauri-apps/plugin-dialog';

interface UnifiedSidebarProps {
  side: SidebarSide;
}

const FIXED_PANEL_META: Record<'settings' | 'review' | 'comments', { icon: typeof Settings; labelKey: string }> = {
  settings: { icon: Settings, labelKey: 'chat.settings' },
  review:   { icon: Search, labelKey: 'review.title' },
  comments: { icon: StickyNote, labelKey: 'comment.title' },
};

function getPanelIcon(panel: PanelType): typeof Settings {
  if (isChatPanel(panel)) return MessageSquare;
  return FIXED_PANEL_META[panel as 'settings' | 'review' | 'comments']?.icon ?? Settings;
}

function getPanelLabel(panel: PanelType, t: (key: string) => string, sessions: { id: string; name: string }[]): string {
  if (isChatPanel(panel)) {
    const sessionId = getChatSessionId(panel);
    const session = sessions.find((s) => s.id === sessionId);
    return session?.name ?? t('chat.title');
  }
  const meta = FIXED_PANEL_META[panel as 'settings' | 'review' | 'comments'];
  return meta ? t(meta.labelKey) : panel;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  panel: PanelType;
}

/**
 * 통합 사이드바 컴포넌트 (Docking Model)
 * panels 배열에 도킹된 패널만 탭으로 표시
 * 마우스 이벤트 기반 커스텀 드래그로 패널 이동/재배열, 우클릭 컨텍스트 메뉴 지원
 */
export function UnifiedSidebar({ side }: UnifiedSidebarProps): JSX.Element {
  const { t } = useTranslation();
  const sidebarKey = side === 'left' ? 'leftSidebar' : 'rightSidebar';

  // 개별 primitive 선택자로 안정적 구독 (useShallow 무한 루프 방지)
  const collapsed = useUIStore((s) => s[sidebarKey].collapsed);
  const panels = useUIStore((s) => s[sidebarKey].panels);
  const activePanel = useUIStore((s) => s[sidebarKey].activePanel);
  const width = useUIStore((s) => resolveLayout(s)[side === 'left' ? 'left' : 'right']);
  const maxWidth = useUIStore((s) => getMaxSidebarWidth(s, side));
  const toggleSidebarCollapse = useUIStore((s) => s.toggleSidebarCollapse);
  const setActivePanel_side = useUIStore((s) => s.setActivePanel_side);
  const movePanel = useUIStore((s) => s.movePanel);
  const setSidebarWidthSide = useUIStore((s) => s.setSidebarWidthSide);

  // chatStore에서 세션 목록 구독 (이름 표시용) — sessions 배열 자체를 구독하고 useMemo로 파생
  const sessions = useChatStore((s) => s.sessions);
  const chatSessions = useMemo(() => sessions.map((ses) => ({ id: ses.id, name: ses.name })), [sessions]);
  const isSessionLimitReached = useChatStore((s) => s.sessions.length >= MAX_CHAT_SESSIONS);

  const minSidebarWidth = useMemo(
    () => (panels.some(isChatPanel) ? LAYOUT.CHAT_SIDEBAR_MIN : LAYOUT.SIDEBAR_MIN),
    [panels],
  );

  const onWidthChange = useCallback(
    (w: number) => setSidebarWidthSide(side, w),
    [side, setSidebarWidthSide],
  );

  const { handleResizeStart } = useResizeHandle({
    width,
    onWidthChange,
    direction: side === 'left' ? 'right' : 'left',
    maxWidth,
    minWidth: minSidebarWidth,
  });

  const borderClass = side === 'left' ? 'border-r' : 'border-l';
  const resizeHandlePosition = side === 'left' ? 'right-0' : 'left-0';

  // --- Mouse-based drag ---
  const { handleTabMouseDown, sidebarRef, draggingPanel, dropIndicator, dragOverSide, isClickSuppressed } = usePanelDrag({ side });

  const isDragOverThis = dragOverSide === side;

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

  // + 버튼: 새 채팅 세션 추가 (현재 사이드에 생성)
  const handleAddChatSession = useCallback(() => {
    const store = useChatStore.getState();
    if (store.isSessionLimitReached()) return;
    const sessionId = store.createSession();
    if (sessionId && side !== 'right') {
      // createSession → addChatPanel이 기본 right에 추가하므로, left면 이동
      useUIStore.getState().movePanel(chatPanelId(sessionId), 'right', side);
    }
  }, [side]);

  // Tab click handler with drag suppression
  const handleTabClick = useCallback((panel: PanelType) => {
    if (isClickSuppressed()) return;
    setActivePanel_side(side, panel);
  }, [isClickSuppressed, setActivePanel_side, side]);

  // --- Empty sidebar: thin drop zone ---
  if (panels.length === 0) {
    return (
      <div
        ref={sidebarRef}
        className={`w-4 h-full ${borderClass} border-editor-border border-dashed bg-editor-surface/30 transition-colors ${isDragOverThis ? 'ring-2 ring-primary-500/30 bg-primary-50/10' : ''}`}
      />
    );
  }

  // --- Collapsed: icons only ---
  if (collapsed) {
    return (
      <div
        ref={sidebarRef}
        className={`w-12 h-full flex flex-col items-center py-2 gap-1 bg-editor-surface ${borderClass} border-editor-border ${isDragOverThis ? 'ring-2 ring-primary-500/30' : ''}`}
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
    if (activePanel === 'comments') return <CommentListPanel />;
    if (isChatPanel(activePanel)) {
      const sessionId = getChatSessionId(activePanel);
      return sessionId ? <ChatContent side={side} sessionId={sessionId} /> : null;
    }
    return null;
  };

  // --- Insertion indicator helper ---
  const renderInsertionIndicator = (index: number) => {
    if (!dropIndicator || dropIndicator.side !== side || dropIndicator.index !== index) return null;
    return <div className="w-0.5 h-6 bg-primary-500 rounded-full shrink-0 self-center" />;
  };

  return (
    <aside
      ref={sidebarRef}
      className={`shrink-0 h-full min-h-0 ${borderClass} border-editor-border bg-editor-bg overflow-hidden relative flex flex-col ${isDragOverThis ? 'ring-2 ring-primary-500/30' : ''}`}
      style={{ width }}
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
          {panels.map((panel, idx) => {
            const label = getPanelLabel(panel, t, chatSessions);
            const isChat = isChatPanel(panel);
            return (
              <div key={panel} className="flex items-center shrink-0">
                {renderInsertionIndicator(idx)}
                <div
                  data-panel-tab={panel}
                  onMouseDown={(e) => handleTabMouseDown(panel, label, e)}
                  onClick={() => handleTabClick(panel)}
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
              </div>
            );
          })}

          {/* Insertion indicator at end */}
          {renderInsertionIndicator(panels.length)}

          {/* + 버튼: 새 채팅 추가 */}
          {!isSessionLimitReached && (
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

      {/* Content: 패널 내부 스크롤이 동작하도록 높이 전달 */}
      <div className="flex-1 min-h-0 flex flex-col">
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
