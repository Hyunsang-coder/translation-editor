import { useCallback, useRef, useEffect } from 'react';

interface UseResizeHandleOptions {
  /** 현재 너비 */
  width: number;
  /** 너비 변경 콜백 */
  onWidthChange: (width: number) => void;
  /** 리사이즈 방향: 'right'이면 오른쪽으로 드래그 시 증가, 'left'이면 왼쪽으로 드래그 시 증가 */
  direction: 'left' | 'right';
  /** 최소 너비 (기본: 200) */
  minWidth?: number;
  /** 최대 너비 (기본: 600) */
  maxWidth?: number;
}

/**
 * 사이드바 리사이즈 핸들 훅
 * direction='right': delta = e.clientX - startX (좌측 사이드바용)
 * direction='left':  delta = startX - e.clientX (우측 사이드바용)
 */
export function useResizeHandle({
  width,
  onWidthChange,
  direction,
  minWidth = 200,
  maxWidth = 600,
}: UseResizeHandleOptions) {
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta =
        direction === 'right'
          ? e.clientX - startX.current
          : startX.current - e.clientX;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth.current + delta));
      onWidthChange(newWidth);
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
  }, [onWidthChange, direction, minWidth, maxWidth]);

  return { handleResizeStart };
}
