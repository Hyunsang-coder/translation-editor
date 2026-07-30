import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** style.height 대입이 offsetHeight에 반영되도록 최소한의 레이아웃을 흉내 낸다. */
function makeSpacer(height = 0) {
  const el = document.createElement('div');
  let current = height;
  Object.defineProperty(el, 'offsetHeight', { get: () => current, configurable: true });
  const style = el.style;
  Object.defineProperty(el, 'style', {
    value: new Proxy(style, {
      set(target, prop, value) {
        if (prop === 'height') current = Number.parseFloat(String(value)) || 0;
        return Reflect.set(target, prop, value);
      },
    }),
    configurable: true,
  });
  return el;
}

/**
 * 콘텐츠 좌표 `contentTop`에 놓인 사용자 메시지.
 * 화면 좌표는 스크롤에 따라 움직이므로 container.scrollTop을 반영해 계산한다.
 */
function makeUserMessage(container: HTMLElement, contentTop: number) {
  const el = document.createElement('div');
  el.setAttribute('data-chat-role', 'user');
  el.getBoundingClientRect = () =>
    ({ top: contentTop - container.scrollTop, bottom: contentTop - container.scrollTop + 40 }) as DOMRect;
  return el;
}

/** 전역 ResizeObserver 목은 콜백을 부르지 않으므로 수동 트리거를 붙인다. */
function installResizeObserver() {
  const callbacks: Array<() => void> = [];
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return {
    trigger: () => callbacks.forEach((cb) => cb()),
    restore: () => {
      globalThis.ResizeObserver = original;
    },
  };
}

/** 애니메이션 없이 최종 위치만 검증하도록 reduced-motion을 강제한다. */
function setReducedMotion(reduce: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('useChatScroll', () => {
  let ro: ReturnType<typeof installResizeObserver>;

  beforeEach(() => {
    ro = installResizeObserver();
    setReducedMotion(true);
  });

  afterEach(() => {
    ro.restore();
    setReducedMotion(false);
  });

  it('사용자가 위로 스크롤하면 버튼이 표시된다', () => {
    const { result } = renderHook(() => useChatScroll(true, 1));
    const container = makeContainer({ scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    act(() => {
      result.current.messagesContainerRef.current = container as HTMLDivElement;
    });

    // 하단 (gap = 0)
    act(() => {
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

  it('패널이 열릴 때 첫 페인트 전에 하단으로 붙는다', () => {
    const container = makeContainer({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => {
        const api = useChatScroll(open, 1);
        api.messagesContainerRef.current = container as HTMLDivElement;
        return api;
      },
      { initialProps: { open: false } },
    );

    expect(container.scrollTo).not.toHaveBeenCalled();

    act(() => {
      rerender({ open: true });
    });

    // 타이머 지연 없이 즉시(behavior: 'auto') 하단으로 이동한다
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
  });

  it('레이아웃이 뒤늦게 끝나 본문이 커져도 하단을 유지한다', () => {
    const container = makeContainer({ scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    const content = document.createElement('div');
    const spacer = makeSpacer(0);
    renderHook(() => {
      const api = useChatScroll(true, 1);
      api.messagesContainerRef.current = container as HTMLDivElement;
      api.messagesContentRef.current = content as HTMLDivElement;
      api.bottomSpacerRef.current = spacer as HTMLDivElement;
      return api;
    });

    (container.scrollTo as ReturnType<typeof vi.fn>).mockClear();

    // 코드블록/마크다운이 늦게 레이아웃되어 본문이 400px 자라남
    Object.defineProperty(container, 'scrollHeight', { value: 1400, configurable: true });
    act(() => {
      ro.trigger();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: 'auto' });
  });

  describe('pin-to-question', () => {
    /**
     * 컨테이너 상단 0, 높이 300. 본문 400px 중 사용자 메시지가 콘텐츠 360px 지점에서 시작한다.
     * 고정 위치 = 360 - PIN_TOP_GAP_PX(12) = 348.
     * 필요한 여백 = clientHeight - (natural - 348) = 300 - (400 - 348) = 248.
     */
    function setup() {
      const container = makeContainer({ scrollHeight: 400, clientHeight: 300, scrollTop: 0 });
      container.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
      const content = document.createElement('div');
      const spacer = makeSpacer(0);
      const userMessage = makeUserMessage(container, 360);
      container.append(userMessage);

      const { result, rerender } = renderHook(
        ({ count }: { count: number }) => {
          const api = useChatScroll(true, count);
          api.messagesContainerRef.current = container as HTMLDivElement;
          api.messagesContentRef.current = content as HTMLDivElement;
          api.bottomSpacerRef.current = spacer as HTMLDivElement;
          return api;
        },
        { initialProps: { count: 1 } },
      );
      return { result, rerender, container, spacer, userMessage };
    }

    /** scrollHeight는 본문 + 여백이므로 여백 변화를 반영해준다. */
    function setNaturalHeight(container: HTMLElement, spacer: HTMLElement, natural: number) {
      Object.defineProperty(container, 'scrollHeight', {
        get: () => natural + spacer.offsetHeight,
        configurable: true,
      });
    }

    /**
     * 리렌더와 프레임 대기를 분리한다. async act는 콜백이 끝난 뒤에야 effect를 flush하므로
     * 같은 act 안에서 기다리면 effect가 예약한 rAF가 아직 큐에 들어오지도 않은 상태가 된다.
     */
    async function commit(rerender: (props: { count: number }) => void, count: number) {
      await act(async () => {
        rerender({ count });
      });
      await act(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
    }

    it('전송 후 사용자 메시지를 상단에 고정하고 한 화면치 여백을 확보한다', async () => {
      const { result, rerender, container, spacer } = setup();
      setNaturalHeight(container, spacer, 400);

      act(() => {
        result.current.requestPinToLatestUserMessage();
      });
      await commit(rerender, 2);

      expect(spacer.offsetHeight).toBe(248);
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 348, behavior: 'auto' });
    });

    it('답변이 길어지면 여백이 같은 양만큼 줄어 스크롤 위치가 움직이지 않는다', async () => {
      const { result, rerender, container, spacer } = setup();
      setNaturalHeight(container, spacer, 400);

      act(() => {
        result.current.requestPinToLatestUserMessage();
      });
      await commit(rerender, 2);
      expect(spacer.offsetHeight).toBe(248);

      // 고정 후 스크롤은 고정 위치(= 하단)에 있다
      Object.defineProperty(container, 'scrollTop', { value: 348, configurable: true });
      const totalBefore = container.scrollHeight;

      // 답변이 100px 자라남 → ResizeObserver가 여백을 다시 잰다
      setNaturalHeight(container, spacer, 500);
      act(() => {
        ro.trigger();
      });

      expect(spacer.offsetHeight).toBe(148);
      // 본문 + 여백 총합이 그대로라 스크롤 위치가 유효하게 유지된다
      expect(container.scrollHeight).toBe(totalBefore);
    });

    it('고정 중에는 본문이 자라도 하단 추종 스크롤이 일어나지 않는다', async () => {
      const { result, rerender, container, spacer } = setup();
      setNaturalHeight(container, spacer, 400);

      act(() => {
        result.current.requestPinToLatestUserMessage();
      });
      await commit(rerender, 2);

      (container.scrollTo as ReturnType<typeof vi.fn>).mockClear();
      Object.defineProperty(container, 'scrollTop', { value: 348, configurable: true });

      setNaturalHeight(container, spacer, 460);
      act(() => {
        ro.trigger();
      });

      expect(container.scrollTo).not.toHaveBeenCalled();
    });

    it('여백이 소진되면 하단과 벌어져 최신 메시지 버튼이 나타난다', async () => {
      const { result, rerender, container, spacer } = setup();
      setNaturalHeight(container, spacer, 400);

      act(() => {
        result.current.requestPinToLatestUserMessage();
      });
      await commit(rerender, 2);

      // 답변이 한 화면보다 길어져 여백이 0으로 수렴
      Object.defineProperty(container, 'scrollTop', { value: 348, configurable: true });
      setNaturalHeight(container, spacer, 900);
      act(() => {
        ro.trigger();
      });
      expect(spacer.offsetHeight).toBe(0);

      // 사용자 스크롤 이벤트에서 하단과의 간격이 임계값을 넘는다
      act(() => {
        result.current.handleMessagesScroll();
      });
      expect(result.current.showScrollToBottom).toBe(true);
    });
  });

  describe('스크롤 애니메이션', () => {
    it('reduced-motion이 아니면 여러 프레임에 걸쳐 보간한다', async () => {
      setReducedMotion(false);
      const container = makeContainer({ scrollHeight: 2000, clientHeight: 300, scrollTop: 0 });
      const { result } = renderHook(() => {
        const api = useChatScroll(true, 1);
        api.messagesContainerRef.current = container as HTMLDivElement;
        return api;
      });

      (container.scrollTo as ReturnType<typeof vi.fn>).mockClear();
      act(() => {
        result.current.scrollToBottom('smooth');
      });
      await act(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });

      const options = (container.scrollTo as ReturnType<typeof vi.fn>).mock.calls
        .map(([arg]) => arg as ScrollToOptions);
      expect(options.length).toBeGreaterThan(1);
      // 중간 프레임은 목적지에 아직 도달하지 않는다 (= 즉시 점프가 아니다)
      expect(options[0]?.top ?? 0).toBeLessThan(2000);
      expect(options.every((o) => o.behavior === 'auto')).toBe(true);
    });

    it('애니메이션 중 wheel 개입이 자동 스크롤을 취소한다', async () => {
      setReducedMotion(false);
      const container = makeContainer({ scrollHeight: 2000, clientHeight: 300, scrollTop: 0 });
      const { rerender, result } = renderHook(
        ({ open }: { open: boolean }) => {
          const api = useChatScroll(open, 1);
          api.messagesContainerRef.current = container as HTMLDivElement;
          return api;
        },
        { initialProps: { open: false } },
      );
      rerender({ open: true });

      act(() => {
        result.current.scrollToBottom('smooth');
      });
      act(() => {
        container.dispatchEvent(new Event('wheel'));
      });

      (container.scrollTo as ReturnType<typeof vi.fn>).mockClear();
      await act(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      // 취소 후에는 더 이상 프레임이 진행되지 않는다
      expect(container.scrollTo).not.toHaveBeenCalled();

      // 사용자 의도가 반영되어 스크롤 이벤트가 버튼을 켤 수 있다
      Object.defineProperty(container, 'scrollTop', { value: 100, configurable: true });
      act(() => {
        result.current.handleMessagesScroll();
      });
      expect(result.current.showScrollToBottom).toBe(true);
    });
  });
});
