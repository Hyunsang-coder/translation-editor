import { useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/uiStore';

/**
 * 반응형 레이아웃 브레이크포인트 상수
 * 윈도우 너비가 해당 값 미만으로 내려가면 패널이 접히거나 숨겨짐
 *
 * 패널 너비 기준:
 * - LeftSidebar: 250px (숨김: 0px)
 * - RightSidebar: 250px (숨김: 0px)
 * - Editor 최소: 400px
 */
export const BREAKPOINTS = {
  /** LeftSidebar 완전 숨김(폭 0) */
  LEFT_SIDEBAR_CLOSE: 1000,
  /** RightSidebar 완전 숨김(폭 0) */
  RIGHT_SIDEBAR_CLOSE: 800,
} as const;

/**
 * 반응형 레이아웃 훅
 *
 * 윈도우 크기 변경에 따라 패널들을 자동으로 접거나 닫음.
 *
 * 축소 우선순위 (너비 감소 시):
 * 1. LeftSidebar → 접힘
 * 2. RightSidebar → 접힘
 * 3. Editor → 마지막에 줄어듦 (항상 보호)
 *
 * 주요 특성:
 * - 자동 레이아웃은 윈도우 크기가 줄어들 때만 적용
 * - 윈도우 크기가 커져도 패널 자동 복원 없음 (업계 표준)
 * - 사용자가 수동으로 열/닫으면 그 상태 유지
 */
export function useResponsiveLayout(): void {
  const autoLayoutEnabled = useUIStore((s) => s.autoLayoutEnabled);
  const setWindowWidth = useUIStore((s) => s.setWindowWidth);

  // 이전 윈도우 너비 추적 (줄어드는 경우만 자동 레이아웃 적용)
  const prevWidthRef = useRef<number | null>(null);

  useEffect(() => {
    if (!autoLayoutEnabled) return;

    const applyResponsiveLayout = (width: number, prevWidth: number | null) => {
      // 너비가 줄어드는 경우에만 자동 레이아웃 적용
      if (prevWidth !== null && width >= prevWidth) {
        return;
      }

      const { setSidebarHiddenSide } = useUIStore.getState();

      // 1순위: LeftSidebar → 완전 숨김(폭 0)
      if (width < BREAKPOINTS.LEFT_SIDEBAR_CLOSE) {
        setSidebarHiddenSide('left', true);
      }

      // 2순위: RightSidebar → 완전 숨김(폭 0)
      if (width < BREAKPOINTS.RIGHT_SIDEBAR_CLOSE) {
        setSidebarHiddenSide('right', true);
      }
    };

    const handleResize = (entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const prevWidth = prevWidthRef.current;

      setWindowWidth(width);
      applyResponsiveLayout(width, prevWidth);

      prevWidthRef.current = width;
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(document.documentElement);

    // 초기 윈도우 크기 설정
    const initialWidth = window.innerWidth;
    setWindowWidth(initialWidth);
    prevWidthRef.current = initialWidth;

    // 초기 로드 시에도 레이아웃 적용 (prevWidth를 null로 전달하여 강제 적용)
    applyResponsiveLayout(initialWidth, null);

    return () => observer.disconnect();
  }, [autoLayoutEnabled, setWindowWidth]);
}
