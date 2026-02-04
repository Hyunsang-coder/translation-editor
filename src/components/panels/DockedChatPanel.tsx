import { useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { ChatContent } from '@/components/chat/ChatContent';

const MIN_WIDTH = 250;
const MAX_WIDTH = 600;

/**
 * 도킹된 채팅 패널 컴포넌트
 * 접힌 상태: 아이콘만 표시
 * 펼친 상태: 채팅 패널 표시
 */
export function DockedChatPanel(): JSX.Element {
  const { t } = useTranslation();
  const chatPanelOpen = useUIStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useUIStore((s) => s.toggleChatPanel);
  const chatPanelWidth = useUIStore((s) => s.chatPanelWidth);
  const setChatPanelWidth = useUIStore((s) => s.setChatPanelWidth);
  const projectTitle = useProjectStore((s) => s.project?.metadata.title);

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

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

  // 접힌 상태: 아이콘만 표시
  if (!chatPanelOpen) {
    return (
      <div className="w-12 h-full flex flex-col items-center py-2 bg-editor-surface border-l border-editor-border">
        <button
          type="button"
          onClick={toggleChatPanel}
          className="p-2.5 rounded-lg hover:bg-editor-border transition-colors text-editor-muted hover:text-editor-text"
          title={t('chat.title')}
        >
          <MessageSquare size={20} />
        </button>
      </div>
    );
  }

  return (
    <aside
      className="shrink-0 border-l border-editor-border bg-editor-bg overflow-hidden relative flex flex-col"
      style={{ width: chatPanelWidth }}
    >
      {/* 헤더 */}
      <div className="h-10 flex items-center px-2 border-b border-editor-border bg-editor-surface shrink-0">
        {/* 접기 버튼 */}
        <button
          type="button"
          onClick={toggleChatPanel}
          className="p-1.5 rounded hover:bg-editor-border transition-colors text-editor-muted"
          title={t('common.collapse', '접기')}
        >
          <MessageSquare size={18} />
        </button>
        <span className="text-sm font-medium text-editor-text truncate ml-2">
          {projectTitle ? `${projectTitle} ${t('chat.title')}` : t('chat.title')}
        </span>
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
