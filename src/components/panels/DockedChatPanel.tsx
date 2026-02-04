import { useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { ChatContent } from '@/components/chat/ChatContent';

const MIN_WIDTH = 250;
const MAX_WIDTH = 600;

/**
 * 도킹된 채팅 패널 컴포넌트
 * ProjectSidebar 우측에 고정 배치, 리사이즈 가능
 */
export function DockedChatPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const chatPanelOpen = useUIStore((s) => s.chatPanelOpen);
  const setChatPanelOpen = useUIStore((s) => s.setChatPanelOpen);
  const chatPanelWidth = useUIStore((s) => s.chatPanelWidth);
  const setChatPanelWidth = useUIStore((s) => s.setChatPanelWidth);
  const projectTitle = useProjectStore((s) => s.project?.metadata.title);

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // 패널 닫힐 때 진행 중인 AI 요청 취소
  useEffect(() => {
    if (!chatPanelOpen) {
      useChatStore.getState().abortController?.abort();
    }
  }, [chatPanelOpen]);

  // 리사이즈 핸들러
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = chatPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatPanelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // 왼쪽으로 드래그하면 너비 증가 (패널이 오른쪽에 있으므로)
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta));
      setChatPanelWidth(newWidth);
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
  }, [setChatPanelWidth]);

  const handleClose = useCallback(() => {
    setChatPanelOpen(false);
  }, [setChatPanelOpen]);

  if (!chatPanelOpen) {
    return null;
  }

  return (
    <aside
      className="shrink-0 border-l border-editor-border bg-editor-bg overflow-hidden relative flex flex-col"
      style={{ width: chatPanelWidth }}
    >
      {/* 헤더 */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-editor-border bg-editor-surface shrink-0">
        <span className="text-sm font-medium text-editor-text truncate">
          {projectTitle ? `${projectTitle} ${t('chat.title')}` : t('chat.title')}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="p-1 rounded hover:bg-editor-border transition-colors text-editor-muted hover:text-editor-text"
          title={t('common.close')}
        >
          <X size={16} />
        </button>
      </div>

      {/* 채팅 콘텐츠 */}
      <div className="flex-1 min-h-0">
        <ChatContent />
      </div>

      {/* 리사이즈 핸들 (좌측) */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />
    </aside>
  );
}
