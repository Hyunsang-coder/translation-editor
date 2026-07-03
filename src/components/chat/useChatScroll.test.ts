import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatScroll } from './useChatScroll';

/** jsdom은 scrollTo/레이아웃 메트릭을 구현하지 않으므로 컨테이너를 수동 구성한다. */
function makeContainer(metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = document.createElement('div');
  el.scrollTo = vi.fn();
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    value: metrics.scrollTop,
    writable: true,
    configurable: true,
  });
  return el;
}

describe('useChatScroll', () => {
  it('smooth 자동 스크롤 중간 프레임은 버튼/stickiness를 건드리지 않는다 (F9)', () => {
    const { result } = renderHook(() => useChatScroll(true, 1, 0));

    // 하단에서 멀리 떨어진 컨테이너를 ref에 연결
    const container = makeContainer({ scrollHeight: 1000, clientHeight: 300, scrollTop: 100 });
    act(() => {
      result.current.messagesContainerRef.current = container as HTMLDivElement;
    });

    // smooth 스크롤 시작 → isAutoScrolling 플래그 on
    act(() => {
      result.current.scrollToBottom('smooth');
    });
    expect(result.current.showScrollToBottom).toBe(false);

    // 애니메이션 중간 프레임(아직 bottom 아님) → 버튼이 켜지면 안 됨
    act(() => {
      result.current.handleMessagesScroll();
    });
    expect(result.current.showScrollToBottom).toBe(false);
  });

  it('플래그 해제 후 사용자가 위로 스크롤하면 버튼이 표시된다', () => {
    const { result } = renderHook(() => useChatScroll(true, 1, 0));
    const container = makeContainer({ scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    act(() => {
      result.current.messagesContainerRef.current = container as HTMLDivElement;
    });

    // bottom 도달 이벤트로 자동 스크롤 플래그 해제 (gap = 0)
    act(() => {
      result.current.scrollToBottom('smooth');
      result.current.handleMessagesScroll();
    });
    expect(result.current.showScrollToBottom).toBe(false);

    // 사용자가 위로 스크롤 (gap = 600 > 100)
    Object.defineProperty(container, 'scrollTop', { value: 100, configurable: true });
    act(() => {
      result.current.handleMessagesScroll();
    });
    expect(result.current.showScrollToBottom).toBe(true);
  });

  it('애니메이션 중 wheel 개입 시 사용자 의도가 우선한다 (F9)', () => {
    // wheel 리스너 effect가 컨테이너를 잡도록 open=false→true로 전환 (실제 앱은 render 시 ref 연결)
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useChatScroll(open, 1, 0),
      { initialProps: { open: false } },
    );
    const container = makeContainer({ scrollHeight: 1000, clientHeight: 300, scrollTop: 100 });
    act(() => {
      result.current.messagesContainerRef.current = container as HTMLDivElement;
    });
    rerender({ open: true });

    act(() => {
      result.current.scrollToBottom('smooth');
    });

    // 사용자가 휠로 개입 → 플래그 해제
    act(() => {
      container.dispatchEvent(new Event('wheel'));
    });

    // 이제 bottom이 아닌 스크롤 이벤트는 버튼을 표시해야 함
    act(() => {
      result.current.handleMessagesScroll();
    });
    expect(result.current.showScrollToBottom).toBe(true);
  });
});
