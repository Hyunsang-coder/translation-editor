import { useRef, useEffect, useCallback, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useTranslation } from 'react-i18next';

const BUTTON_SIZE = 56; // w-14 h-14 = 56px
const MARGIN = 24; // bottom-6 right-6 = 24px

/**
 * 플로팅 채팅 버튼 컴포넌트
 * 우측 하단에 고정된 FAB 스타일 버튼 (드래그로 위치 변경 가능)
 */
export function FloatingChatButton(): JSX.Element {
  const { t } = useTranslation();
  const chatPanelOpen = useUIStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useUIStore((s) => s.toggleChatPanel);
  const floatingButtonPosition = useUIStore((s) => s.floatingButtonPosition);
  const setFloatingButtonPosition = useUIStore((s) => s.setFloatingButtonPosition);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const isDragging = useRef(false);
  const hasMoved = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startButtonPos = useRef({ x: 0, y: 0 });

  // 현재 위치 계산 (null이면 기본 우측 하단)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (floatingButtonPosition) {
      setCurrentPos(floatingButtonPosition);
    } else {
      // 기본 위치: 우측 하단
      setCurrentPos({
        x: window.innerWidth - BUTTON_SIZE - MARGIN,
        y: window.innerHeight - BUTTON_SIZE - MARGIN,
      });
    }
  }, [floatingButtonPosition]);

  // 윈도우 리사이즈 시 위치 조정
  useEffect(() => {
    const handleResize = () => {
      if (!floatingButtonPosition) {
        // 기본 위치일 경우 우측 하단 유지
        setCurrentPos({
          x: window.innerWidth - BUTTON_SIZE - MARGIN,
          y: window.innerHeight - BUTTON_SIZE - MARGIN,
        });
      } else {
        // 저장된 위치가 화면 밖으로 나가지 않도록
        const maxX = window.innerWidth - BUTTON_SIZE;
        const maxY = window.innerHeight - BUTTON_SIZE;
        setCurrentPos({
          x: Math.max(0, Math.min(floatingButtonPosition.x, maxX)),
          y: Math.max(0, Math.min(floatingButtonPosition.y, maxY)),
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [floatingButtonPosition]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // 좌클릭만
    isDragging.current = true;
    hasMoved.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    startButtonPos.current = currentPos || { x: 0, y: 0 };
    document.body.style.userSelect = 'none';
  }, [currentPos]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - startPos.current.x;
      const deltaY = e.clientY - startPos.current.y;

      // 5px 이상 이동했을 때만 드래그로 간주
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMoved.current = true;
      }

      const newX = Math.max(0, Math.min(window.innerWidth - BUTTON_SIZE, startButtonPos.current.x + deltaX));
      const newY = Math.max(0, Math.min(window.innerHeight - BUTTON_SIZE, startButtonPos.current.y + deltaY));

      setCurrentPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.userSelect = '';

        // 이동했으면 위치 저장
        if (hasMoved.current && currentPos) {
          setFloatingButtonPosition(currentPos);
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [currentPos, setFloatingButtonPosition]);

  const handleClick = useCallback(() => {
    // 드래그 중이 아니었을 때만 토글
    if (!hasMoved.current) {
      toggleChatPanel();
    }
  }, [toggleChatPanel]);

  // 더블클릭으로 기본 위치로 리셋
  const handleDoubleClick = useCallback(() => {
    setFloatingButtonPosition(null);
    setCurrentPos({
      x: window.innerWidth - BUTTON_SIZE - MARGIN,
      y: window.innerHeight - BUTTON_SIZE - MARGIN,
    });
  }, [setFloatingButtonPosition]);

  // 채팅 패널이 열려있으면 버튼 숨김
  if (!currentPos || chatPanelOpen) return <></>;

  return (
    <button
      ref={buttonRef}
      type="button"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'fixed',
        left: currentPos.x,
        top: currentPos.y,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        zIndex: 9999,
      }}
      className={`
        rounded-full
        flex items-center justify-center
        shadow-lg hover:shadow-xl
        transition-shadow duration-200
        cursor-grab active:cursor-grabbing
        ${chatPanelOpen
          ? 'bg-editor-surface border border-editor-border text-editor-muted hover:bg-editor-border'
          : 'bg-primary-500 text-white hover:bg-primary-600'
        }
      `}
      title={`${chatPanelOpen ? t('chat.closePanel') : t('chat.openChat')} (더블클릭: 위치 초기화)`}
      aria-label={chatPanelOpen ? t('chat.closePanel') : t('chat.openChat')}
    >
      <span className="text-xl">
        {chatPanelOpen ? '✕' : '💬'}
      </span>
    </button>
  );
}
