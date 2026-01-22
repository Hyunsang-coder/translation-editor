import { useRef, useEffect, useCallback, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useTranslation } from 'react-i18next';

const BUTTON_SIZE = 48; // 기본 크기
const BUTTON_SIZE_HOVER = 52; // hover 시 크기
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
  const [isHovered, setIsHovered] = useState(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  // 툴팁은 실제 마우스 진입 이벤트가 있어야만 표시
  // (버튼이 마우스 아래에 나타나는 경우 제외)
  const [tooltipEnabled, setTooltipEnabled] = useState(false);
  const mouseMoveCountRef = useRef(0);
  const initialMouseMoveCountRef = useRef(0);

  // 마우스 이동 횟수 추적 (버튼 마운트 시점 기준으로 실제 이동 감지)
  useEffect(() => {
    const handleMouseMove = () => {
      mouseMoveCountRef.current += 1;
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // 버튼이 보일 때 현재 마우스 이동 횟수 기록
  useEffect(() => {
    if (!chatPanelOpen) {
      initialMouseMoveCountRef.current = mouseMoveCountRef.current;
      setTooltipEnabled(false);
    }
  }, [chatPanelOpen]);

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
    setIsDraggingState(true);
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

      // 버튼이 화면 안에 완전히 보이도록 경계 설정
      const newX = Math.max(0, Math.min(window.innerWidth - BUTTON_SIZE, startButtonPos.current.x + deltaX));
      const newY = Math.max(0, Math.min(window.innerHeight - BUTTON_SIZE, startButtonPos.current.y + deltaY));

      setCurrentPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsDraggingState(false);
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

  const currentSize = isHovered ? BUTTON_SIZE_HOVER : BUTTON_SIZE;
  // hover 시 크기 변화에 따른 위치 보정 (중심 유지)
  const sizeOffset = isHovered ? (BUTTON_SIZE_HOVER - BUTTON_SIZE) / 2 : 0;

  // 툴팁 위치 결정: 버튼이 화면 왼쪽 절반에 있으면 툴팁을 오른쪽에, 아니면 왼쪽에
  const tooltipOnRight = currentPos.x < window.innerWidth / 2;

  return (
    <>
      {/* 메인 버튼 - 독립적으로 위치 */}
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => {
          setIsHovered(true);
          // 툴팁 활성화: 버튼이 나타난 후 마우스가 실제로 움직였을 때만
          // (버튼이 마우스 아래에 갑자기 나타난 경우 제외)
          const hasMouseMovedSinceButtonAppeared =
            mouseMoveCountRef.current > initialMouseMoveCountRef.current;
          if (hasMouseMovedSinceButtonAppeared) {
            setTooltipEnabled(true);
          }
        }}
        onMouseLeave={() => {
          setIsHovered(false);
        }}
        style={{
          position: 'fixed',
          left: currentPos.x - sizeOffset,
          top: currentPos.y - sizeOffset,
          width: currentSize,
          height: currentSize,
          zIndex: 9999,
        }}
        className={`
          rounded-full overflow-hidden
          flex items-center justify-center
          shadow-lg hover:shadow-xl
          transition-all duration-200 ease-out
          cursor-grab active:cursor-grabbing
        `}
        title={t('chat.openChat')}
        aria-label={t('chat.openChat')}
      >
        <img
          src="/app-icon-64.png"
          alt="OddEyes.ai"
          className="w-full h-full object-cover"
          draggable={false}
        />
      </button>

      {/* 툴팁 라벨 - hover 시에만 표시 (패널 닫힌 직후 제외) */}
      {isHovered && !isDraggingState && tooltipEnabled && (
        <div
          style={{
            position: 'fixed',
            top: currentPos.y + (BUTTON_SIZE - 32) / 2, // 버튼 중앙에 맞춤
            ...(tooltipOnRight
              ? { left: currentPos.x + BUTTON_SIZE + 8 }
              : { right: window.innerWidth - currentPos.x + 8 }),
            zIndex: 9998,
          }}
          className={`
            flex items-center px-3 py-1.5
            bg-editor-bg border border-editor-border rounded-full
            shadow-md whitespace-nowrap
            animate-in fade-in slide-in-from-left-1 duration-150
            ${tooltipOnRight ? '' : 'slide-in-from-right-1'}
          `}
        >
          <span className="text-sm text-editor-text font-medium">
            {t('chat.askAnything', 'Ask anything')}
          </span>
        </div>
      )}
    </>
  );
}
