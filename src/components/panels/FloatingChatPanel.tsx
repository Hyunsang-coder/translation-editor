import { useEffect, useCallback, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { ChatContent } from '@/components/chat/ChatContent';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 600;

/**
 * 플로팅 채팅 패널 컴포넌트
 * 드래그/리사이즈 가능한 독립적인 채팅 창
 */
export function FloatingChatPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const chatPanelOpen = useUIStore((s) => s.chatPanelOpen);
  const setChatPanelOpen = useUIStore((s) => s.setChatPanelOpen);
  const chatPanelPinned = useUIStore((s) => s.chatPanelPinned);
  const toggleChatPanelPinned = useUIStore((s) => s.toggleChatPanelPinned);
  const chatPanelPosition = useUIStore((s) => s.chatPanelPosition);
  const setChatPanelPosition = useUIStore((s) => s.setChatPanelPosition);
  const chatPanelSize = useUIStore((s) => s.chatPanelSize);
  const setChatPanelSize = useUIStore((s) => s.setChatPanelSize);

  const hasInitialized = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 초기 위치 설정 (첫 렌더링 시)
  useEffect(() => {
    if (hasInitialized.current) return;

    // 저장된 위치가 기본값(0, 100)이면 화면 기준으로 계산
    if (chatPanelPosition.x === 0 && chatPanelPosition.y === 100) {
      const x = Math.max(20, window.innerWidth - DEFAULT_WIDTH - 80);
      const y = Math.max(60, (window.innerHeight - DEFAULT_HEIGHT) / 2);
      setChatPanelPosition({ x, y });
    }
    hasInitialized.current = true;
  }, [chatPanelPosition, setChatPanelPosition]);

  // 화면 크기 변경 시 패널이 경계 밖으로 나가지 않도록
  useEffect(() => {
    const handleResize = () => {
      const { chatPanelPosition, chatPanelSize, setChatPanelPosition } = useUIStore.getState();
      const maxX = window.innerWidth - chatPanelSize.width;
      const maxY = window.innerHeight - chatPanelSize.height;

      const newX = Math.max(0, Math.min(chatPanelPosition.x, maxX));
      const newY = Math.max(0, Math.min(chatPanelPosition.y, maxY));

      if (newX !== chatPanelPosition.x || newY !== chatPanelPosition.y) {
        setChatPanelPosition({ x: newX, y: newY });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 패널 닫힐 때 진행 중인 AI 요청 취소
  useEffect(() => {
    if (!chatPanelOpen) {
      useChatStore.getState().abortController?.abort();
    }
  }, [chatPanelOpen]);

  // 외부 클릭 시 패널 최소화 (고정 상태가 아닐 때만)
  useEffect(() => {
    if (!chatPanelOpen || chatPanelPinned) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // 패널 내부 클릭이면 무시
      if (panelRef.current?.contains(target)) return;

      setChatPanelOpen(false);
    };

    // mousedown 사용 (click보다 먼저 발생, 에디터 클릭과 충돌 방지)
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chatPanelOpen, chatPanelPinned, setChatPanelOpen]);

  const handleClose = useCallback(() => {
    setChatPanelOpen(false);
  }, [setChatPanelOpen]);

  const handleDragStop = useCallback(
    (_e: unknown, data: { x: number; y: number }) => {
      setChatPanelPosition({ x: data.x, y: data.y });
    },
    [setChatPanelPosition]
  );

  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _direction: unknown,
      ref: HTMLElement,
      _delta: unknown,
      position: { x: number; y: number }
    ) => {
      setChatPanelSize({
        width: ref.offsetWidth,
        height: ref.offsetHeight,
      });
      setChatPanelPosition(position);
    },
    [setChatPanelSize, setChatPanelPosition]
  );

  if (!chatPanelOpen) {
    return null;
  }

  return (
    <Rnd
      position={chatPanelPosition}
      size={chatPanelSize}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      bounds="window"
      dragHandleClassName="floating-chat-handle"
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      style={{ zIndex: 9998 }}
      className="rounded-xl shadow-2xl border border-editor-border bg-editor-bg overflow-hidden"
    >
      <div ref={panelRef} className="h-full flex flex-col">
        {/* 드래그 핸들 (헤더) */}
        <div className="floating-chat-handle h-10 flex items-center justify-between px-3 border-b border-editor-border bg-editor-surface cursor-move select-none">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-editor-text">{t('chat.title')}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* 고정 핀 버튼 */}
            <button
              type="button"
              onClick={toggleChatPanelPinned}
              className={`p-1.5 rounded transition-colors ${
                chatPanelPinned
                  ? 'text-accent-primary hover:bg-editor-border'
                  : 'text-editor-muted hover:bg-editor-border hover:text-editor-text'
              }`}
              title={chatPanelPinned ? t('chat.unpinPanel') : t('chat.pinPanel')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill={chatPanelPinned ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
              </svg>
            </button>
            {/* 최소화 버튼 */}
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded hover:bg-editor-border transition-colors text-editor-muted hover:text-editor-text"
              title={t('chat.minimizePanel')}
            >
              <span className="text-lg leading-none">−</span>
            </button>
          </div>
        </div>

        {/* 채팅 콘텐츠 */}
        <div className="flex-1 min-h-0">
          <ChatContent />
        </div>
      </div>
    </Rnd>
  );
}
