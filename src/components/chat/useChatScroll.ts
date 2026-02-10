import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 채팅 메시지 영역 자동 스크롤 + 스크롤 투 바텀 버튼 관리
 */
export function useChatScroll(
  chatPanelOpen: boolean,
  messageCount: number | undefined,
) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Chat 패널 열릴 때 스크롤
  useEffect(() => {
    if (!chatPanelOpen) return;
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [chatPanelOpen]);

  // 메시지 추가 시 자동 스크롤
  useEffect(() => {
    if (chatPanelOpen && messageCount) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messageCount, chatPanelOpen]);

  // 스크롤 위치 감지 (맨 아래가 아니면 버튼 표시)
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  // 최신 메시지로 스크롤
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    showScrollToBottom,
    handleMessagesScroll,
    scrollToBottom,
  };
}
