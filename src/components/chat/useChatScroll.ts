import { useEffect, useRef, useState, useCallback } from 'react';

const BOTTOM_THRESHOLD_PX = 100;

/**
 * 채팅 메시지 영역 자동 스크롤 + 스크롤 투 바텀 버튼 관리
 */
export function useChatScroll(
  chatPanelOpen: boolean,
  messageCount: number | undefined,
  streamingContentLength = 0,
) {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  // smooth 스크롤 애니메이션의 중간 프레임이 stick-to-bottom을 해제하지 않도록 하는 플래그
  const isAutoScrollingRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (behavior === 'smooth') isAutoScrollingRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  // Chat 패널 열릴 때 스크롤
  useEffect(() => {
    if (!chatPanelOpen) return;
    const timer = setTimeout(() => {
      scrollToBottom('auto');
    }, 100);
    return () => clearTimeout(timer);
  }, [chatPanelOpen, scrollToBottom]);

  // 메시지 추가 시 자동 스크롤
  useEffect(() => {
    if (chatPanelOpen && messageCount && shouldStickToBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [messageCount, chatPanelOpen, scrollToBottom]);

  // 스트리밍 응답이 길어질 때는 사용자가 하단에 머물러 있는 경우에만 따라간다.
  // scrollIntoView()는 상위 overflow:hidden 조상까지 움직일 수 있어 메시지 컨테이너만 직접 스크롤한다.
  useEffect(() => {
    if (!chatPanelOpen || !streamingContentLength || !shouldStickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [streamingContentLength, chatPanelOpen, scrollToBottom]);

  // 사용자 개입(애니메이션 중 wheel/터치)이 자동 스크롤 플래그에 갇히지 않도록 해제
  useEffect(() => {
    if (!chatPanelOpen) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    const cancelAutoScroll = () => {
      isAutoScrollingRef.current = false;
    };
    container.addEventListener('wheel', cancelAutoScroll, { passive: true });
    container.addEventListener('touchmove', cancelAutoScroll, { passive: true });
    return () => {
      container.removeEventListener('wheel', cancelAutoScroll);
      container.removeEventListener('touchmove', cancelAutoScroll);
    };
  }, [chatPanelOpen]);

  // 스크롤 위치 감지 (맨 아래가 아니면 버튼 표시)
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX;
    if (isAutoScrollingRef.current) {
      // 자동 스크롤 애니메이션 프레임: bottom 도달 시 플래그 해제, stickiness/버튼은 건드리지 않음
      if (isAtBottom) isAutoScrollingRef.current = false;
      return;
    }
    shouldStickToBottomRef.current = isAtBottom;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  return {
    messagesContainerRef,
    showScrollToBottom,
    handleMessagesScroll,
    scrollToBottom,
  };
}
