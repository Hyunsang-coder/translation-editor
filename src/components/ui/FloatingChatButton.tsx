import { useUIStore } from '@/stores/uiStore';
import { useTranslation } from 'react-i18next';

/**
 * 플로팅 채팅 버튼 컴포넌트
 * 우측 하단에 고정된 FAB 스타일 버튼
 */
export function FloatingChatButton(): JSX.Element {
  const { t } = useTranslation();
  const chatPanelOpen = useUIStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useUIStore((s) => s.toggleChatPanel);

  return (
    <button
      type="button"
      onClick={toggleChatPanel}
      className={`
        fixed bottom-6 right-6 z-[9999]
        w-14 h-14 rounded-full
        flex items-center justify-center
        shadow-lg hover:shadow-xl
        transition-all duration-200
        ${chatPanelOpen
          ? 'bg-editor-surface border border-editor-border text-editor-muted hover:bg-editor-border'
          : 'bg-primary-500 text-white hover:bg-primary-600'
        }
      `}
      title={chatPanelOpen ? t('chat.closePanel') : t('chat.openChat')}
      aria-label={chatPanelOpen ? t('chat.closePanel') : t('chat.openChat')}
    >
      <span className="text-xl">
        {chatPanelOpen ? '✕' : '💬'}
      </span>
    </button>
  );
}
