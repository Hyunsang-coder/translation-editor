import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, PanelLeftClose, PanelRightClose } from 'lucide-react';
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
import { chatPanelId, isChatPanel, getChatSessionId } from '@/types';
import { confirm } from '@tauri-apps/plugin-dialog';

interface UnifiedSidebarProps {
  side: SidebarSide;
}

const FIXED_PANEL_LABEL_KEY: Record<'settings' | 'review' | 'comments', string> = {
  settings: 'chat.settings',
  review:   'review.title',
  comments: 'comment.title',
};

function getPanelLabel(panel: PanelType, t: (key: string) => string, sessions: { id: string; name: string }[]): string {
  if (isChatPanel(panel)) {
    const sessionId = getChatSessionId(panel);
    const session = sessions.find((s) => s.id === sessionId);
    return session?.name ?? t('chat.title');
  }
  const labelKey = FIXED_PANEL_LABEL_KEY[panel as 'settings' | 'review' | 'comments'];
  return labelKey ? t(labelKey) : panel;
}

/**
 * 통합 사이드바 컴포넌트 (Docking Model)
 * panels 배열에 도킹된 패널만 탭으로 표시
 * 마우스 이벤트 기반 커스텀 드래그로 패널 재배열 지원.
 * 역할 잠금: 좌=고정패널 전용, 우=채팅 전용 (양방향 이동 차단).
 */
export function UnifiedSidebar({ side }: UnifiedSidebarProps): JSX.Element | null {
  const { t } = useTranslation();
  const sidebarKey = side === 'left' ? 'leftSidebar' : 'rightSidebar';

  // 개별 primitive 선택자로 안정적 구독 (useShallow 무한 루프 방지)
  const hidden = useUIStore((s) => s[sidebarKey].hidden);
  const panels = useUIStore((s) => s[sidebarKey].panels);
  const activePanel = useUIStore((s) => s[sidebarKey].activePanel);
  const width = useUIStore((s) => resolveLayout(s)[side === 'left' ? 'left' : 'right']);
  const maxWidth = useUIStore((s) => getMaxSidebarWidth(s, side));
  const setSidebarHiddenSide = useUIStore((s) => s.setSidebarHiddenSide);
  const setActivePanel_side = useUIStore((s) => s.setActivePanel_side);
  const setSidebarWidthSide = useUIStore((s) => s.setSidebarWidthSide);
  const floatingChatSessionId = useUIStore((s) => s.floatingChatSessionId);
  const floatChatPanel = useUIStore((s) => s.floatChatPanel);

  // chatStore에서 세션 목록 구독 (이름 표시용) — sessions 배열 자체를 구독하고 useMemo로 파생
  const sessions = useChatStore((s) => s.sessions);
  const chatSessions = useMemo(() => sessions.map((ses) => ({ id: ses.id, name: ses.name })), [sessions]);
  const isSessionLimitReached = useChatStore((s) => s.sessions.length >= MAX_CHAT_SESSIONS);
  const floatingPanel = floatingChatSessionId ? chatPanelId(floatingChatSessionId) : null;
  const visiblePanels = useMemo(
    () => panels.filter((panel) => panel !== floatingPanel),
    [floatingPanel, panels],
  );

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

  // + 버튼: 새 채팅 세션 추가 (우측 전용) — createSession → addChatPanel이 우측에 도킹
  const handleAddChatSession = useCallback(() => {
    const store = useChatStore.getState();
    if (store.isSessionLimitReached()) return;
    store.createSession();
  }, []);

  // Tab click handler with drag suppression
  const handleTabClick = useCallback((panel: PanelType) => {
    if (isClickSuppressed()) return;
    setActivePanel_side(side, panel);
  }, [isClickSuppressed, setActivePanel_side, side]);

  // --- Hidden 또는 빈 바: 폭 0 완전 숨김 (프로젝트 사이드바와 동일 모델) ---
  if (hidden || visiblePanels.length === 0) {
    return null;
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
        {/* Hide button (폭 0 완전 숨김) */}
        <button
          type="button"
          onClick={() => setSidebarHiddenSide(side, true)}
          className="p-2 hover:bg-editor-border transition-colors text-editor-muted"
          title={t('common.hide', 'Hide')}
          data-testid={`sidebar-hide-${side}`}
        >
          {side === 'left' ? <PanelLeftClose size={18} /> : <PanelRightClose size={18} />}
        </button>

        <div className="flex-1 flex items-center overflow-x-auto no-scrollbar">
          {visiblePanels.map((panel, idx) => {
            const label = getPanelLabel(panel, t, chatSessions);
            const isChat = isChatPanel(panel);
            return (
              <div key={panel} className="flex items-center shrink-0">
                {renderInsertionIndicator(idx)}
                <div
                  data-panel-tab={panel}
                  onMouseDown={(e) => handleTabMouseDown(panel, label, e)}
                  onClick={() => handleTabClick(panel)}
                  className={`
                    group relative h-10 px-3 flex items-center gap-1.5 text-xs font-medium cursor-pointer border-r border-editor-border min-w-[60px] max-w-[180px]
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
                    <div className={`flex items-center ${activePanel === panel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <button
                        type="button"
                        data-testid={`float-chat-${getChatSessionId(panel) ?? ''}`}
                        className="p-0.5 rounded hover:bg-editor-border/50 leading-none"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const sessionId = getChatSessionId(panel);
                          if (sessionId) floatChatPanel(sessionId);
                        }}
                        title={t('chat.floatPanel', 'Float chat')}
                        aria-label={t('chat.floatPanel', 'Float chat')}
                      >
                        <ExternalLink size={12} />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-editor-border/50 text-[10px] leading-none"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => void handleCloseChatTab(panel, e)}
                        title={t('common.close')}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Insertion indicator at end */}
          {renderInsertionIndicator(visiblePanels.length)}

          {/* + 버튼: 새 채팅 추가 (우측 채팅 바 전용) */}
          {side === 'right' && !isSessionLimitReached && (
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
    </aside>
  );
}
