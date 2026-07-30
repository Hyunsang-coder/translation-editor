import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

const BOTTOM_THRESHOLD_PX = 100;
/** 고정한 사용자 메시지를 뷰포트 상단에 붙일 때 남기는 여백 */
const PIN_TOP_GAP_PX = 12;
/** ChatMessageItem이 부여하는 역할 속성 */
const USER_MESSAGE_SELECTOR = '[data-chat-role="user"]';
/** 스크롤 애니메이션 속도. 브라우저 smooth는 duration을 지정할 수 없어 직접 보간한다. */
const SCROLL_MS_PER_PX = 0.7;
const SCROLL_MIN_MS = 260;
const SCROLL_MAX_MS = 520;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 대상이 컨테이너 상단에 오도록 하는 스크롤 위치 */
function pinScrollTop(container: HTMLElement, target: HTMLElement): number {
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  return Math.max(0, container.scrollTop + offset - PIN_TOP_GAP_PX);
}

/**
 * 채팅 메시지 영역 스크롤 관리.
 *
 * 전송한 사용자 메시지를 뷰포트 상단에 고정하고(pin), 그 아래에 한 화면치 여백을 깔아
 * 답변이 여백을 채우며 흘러나오게 한다. 답변이 길어지는 만큼 여백이 정확히 같은 양으로
 * 줄어들기 때문에 스크롤 위치가 전혀 움직이지 않는다 — 청크마다 하단을 쫓아가며
 * 화면이 튀던 동작이 애초에 발생하지 않는다.
 *
 * 여백이 0이 된 뒤(= 답변이 한 화면보다 김)에는 더 이상 흡수할 수 없으므로
 * 하단과의 간격이 벌어지고 "최신 메시지로" 버튼이 나타난다.
 *
 * 높이 변화는 토큰 수가 아니라 `messagesContentRef`의 ResizeObserver로 감지한다.
 * 마크다운·코드블록·이미지가 뒤늦게 레이아웃되는 것까지 잡아야 마지막 응답의 꼬리가
 * 잘리지 않는다.
 */
export function useChatScroll(chatPanelOpen: boolean, messageCount: number | undefined) {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const bottomSpacerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  // 스크롤 애니메이션 중에는 중간 프레임이 stick-to-bottom을 해제하지 않도록 한다.
  const isAutoScrollingRef = useRef(false);
  const cancelScrollRef = useRef<(() => void) | null>(null);
  // 상단에 고정한 사용자 메시지. null이면 하단 유지 방식으로 동작한다.
  const pinnedElementRef = useRef<HTMLElement | null>(null);
  // 전송했지만 아직 DOM에 그려지지 않은 사용자 메시지 대기 플래그
  const pendingPinRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const stopScrollAnimation = useCallback((): void => {
    cancelScrollRef.current?.();
    cancelScrollRef.current = null;
  }, []);

  /** 거리에 비례한 duration + ease-out으로 부드럽게 이동한다. */
  const animateScrollTo = useCallback((container: HTMLElement, to: number): void => {
    stopScrollAnimation();
    const from = container.scrollTop;
    const distance = to - from;

    if (Math.abs(distance) < 1 || prefersReducedMotion()) {
      container.scrollTo({ top: to, behavior: 'auto' });
      return;
    }

    const duration = Math.min(
      SCROLL_MAX_MS,
      Math.max(SCROLL_MIN_MS, Math.abs(distance) * SCROLL_MS_PER_PX),
    );
    let startedAt: number | null = null;
    let frame = 0;
    let cancelled = false;

    const step = (timestamp: number): void => {
      if (cancelled) return;
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      container.scrollTo({ top: from + distance * eased, behavior: 'auto' });
      if (progress < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      cancelScrollRef.current = null;
      isAutoScrollingRef.current = false;
    };

    isAutoScrollingRef.current = true;
    frame = requestAnimationFrame(step);
    cancelScrollRef.current = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      isAutoScrollingRef.current = false;
    };
  }, [stopScrollAnimation]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (!container) return;

    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    if (behavior === 'smooth') {
      animateScrollTo(container, container.scrollHeight);
      return;
    }
    stopScrollAnimation();
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
  }, [animateScrollTo, stopScrollAnimation]);

  /**
   * 하단 여백 높이를 다시 계산한다.
   * - `required`: 고정 대상이 상단에 오는 위치까지 스크롤이 가능해야 한다.
   * - `keepCurrent`: 여백이 줄면서 현재 스크롤 위치가 잘려 화면이 튀면 안 된다.
   * 본문이 길어질수록 둘 다 같은 양만큼 줄어 여백이 0으로 수렴한다.
   */
  const resizeBottomSpacer = useCallback((): void => {
    const container = messagesContainerRef.current;
    const spacer = bottomSpacerRef.current;
    if (!container || !spacer) return;

    // 세션 전환·메시지 삭제로 고정 대상이 사라졌으면 고정을 푼다.
    const pinned = pinnedElementRef.current;
    if (pinned && !container.contains(pinned)) pinnedElementRef.current = null;

    const naturalHeight = container.scrollHeight - spacer.offsetHeight;
    const target = pinnedElementRef.current;
    const required = target
      ? container.clientHeight - (naturalHeight - pinScrollTop(container, target))
      : 0;
    const keepCurrent = container.clientHeight - (naturalHeight - container.scrollTop);
    const next = Math.max(0, Math.round(required), Math.round(keepCurrent));

    if (Math.abs(next - spacer.offsetHeight) >= 1) {
      spacer.style.height = `${next}px`;
    }
  }, []);

  /** 전송 직후 호출. 사용자 메시지가 그려지면 상단에 고정한다. */
  const requestPinToLatestUserMessage = useCallback((): void => {
    pendingPinRef.current = true;
  }, []);

  const pinLatestUserMessage = useCallback((): boolean => {
    const container = messagesContainerRef.current;
    if (!container) return false;
    const nodes = container.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR);
    const target = nodes[nodes.length - 1];
    if (!target) return false;

    pinnedElementRef.current = target;
    resizeBottomSpacer();
    // 고정 중에는 여백이 뷰포트를 붙잡으므로 하단 유지를 끈다.
    // 사용자가 "최신 메시지로" 버튼을 누르면 scrollToBottom이 다시 켠다.
    shouldStickToBottomRef.current = false;
    setShowScrollToBottom(false);
    animateScrollTo(container, pinScrollTop(container, target));
    return true;
  }, [resizeBottomSpacer, animateScrollTo]);

  // 패널이 열릴 때는 첫 페인트 전에 하단으로 붙인다.
  // 예전처럼 타이머로 미루면 대화 맨 위가 잠깐 보였다가 튀어 내려간다.
  useLayoutEffect(() => {
    if (!chatPanelOpen) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    stopScrollAnimation();
    pinnedElementRef.current = null;
    pendingPinRef.current = false;
    if (bottomSpacerRef.current) bottomSpacerRef.current.style.height = '0px';
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
  }, [chatPanelOpen, stopScrollAnimation]);

  // 본문 높이가 바뀔 때마다(스트리밍·마크다운 레이아웃·이미지 로드·응답 확정)
  // 여백을 다시 재고, 하단에 붙어 있었다면 계속 하단을 유지한다.
  useEffect(() => {
    if (!chatPanelOpen) return;
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      resizeBottomSpacer();
      if (shouldStickToBottomRef.current && !isAutoScrollingRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [chatPanelOpen, resizeBottomSpacer]);

  // 전송한 사용자 메시지가 DOM에 나타나면 상단에 고정
  useEffect(() => {
    if (!chatPanelOpen || !pendingPinRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (pinLatestUserMessage()) pendingPinRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [messageCount, chatPanelOpen, pinLatestUserMessage]);

  // 사용자 개입(애니메이션 중 wheel/터치)은 자동 스크롤보다 우선한다.
  useEffect(() => {
    if (!chatPanelOpen) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    const cancelAutoScroll = () => stopScrollAnimation();
    container.addEventListener('wheel', cancelAutoScroll, { passive: true });
    container.addEventListener('touchmove', cancelAutoScroll, { passive: true });
    return () => {
      container.removeEventListener('wheel', cancelAutoScroll);
      container.removeEventListener('touchmove', cancelAutoScroll);
    };
  }, [chatPanelOpen, stopScrollAnimation]);

  useEffect(() => stopScrollAnimation, [stopScrollAnimation]);

  // 스크롤 위치 감지 (맨 아래가 아니면 버튼 표시)
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // 자동 스크롤 애니메이션의 중간 프레임은 사용자 의도가 아니다.
    if (isAutoScrollingRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX;
    shouldStickToBottomRef.current = isAtBottom;
    setShowScrollToBottom(!isAtBottom);
  }, []);

  return {
    messagesContainerRef,
    messagesContentRef,
    bottomSpacerRef,
    showScrollToBottom,
    handleMessagesScroll,
    scrollToBottom,
    requestPinToLatestUserMessage,
  };
}
