import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { GripHorizontal, PanelRightOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatContent } from '@/components/chat/ChatContent';
import {
  clampFloatingChatRect,
  resizeFloatingChatRect,
  type FloatingChatResizeDirection,
} from '@/components/chat/floatingChatLayout';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import type { FloatingChatRect } from '@/types';

type Interaction = {
  type: 'drag';
  startX: number;
  startY: number;
  startRect: FloatingChatRect;
} | {
  type: 'resize';
  direction: FloatingChatResizeDirection;
  startX: number;
  startY: number;
  startRect: FloatingChatRect;
};

const RESIZE_HANDLES: Array<{ direction: FloatingChatResizeDirection; className: string }> = [
  { direction: 'n', className: 'absolute z-50 top-0 left-4 right-4 h-2 cursor-ns-resize' },
  { direction: 's', className: 'absolute z-50 bottom-0 left-4 right-4 h-2 cursor-ns-resize' },
  { direction: 'e', className: 'absolute z-50 right-0 top-4 bottom-4 w-2 cursor-ew-resize' },
  { direction: 'w', className: 'absolute z-50 left-0 top-4 bottom-4 w-2 cursor-ew-resize' },
  { direction: 'ne', className: 'absolute z-50 right-0 top-0 h-4 w-4 cursor-nesw-resize' },
  { direction: 'sw', className: 'absolute z-50 left-0 bottom-0 h-4 w-4 cursor-nesw-resize' },
  { direction: 'nw', className: 'absolute z-50 left-0 top-0 h-4 w-4 cursor-nwse-resize' },
  { direction: 'se', className: 'absolute z-50 right-0 bottom-0 h-5 w-5 cursor-nwse-resize' },
];

function rectEquals(a: FloatingChatRect, b: FloatingChatRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** `.floating-panel-exit` 애니메이션 길이와 맞춘다 (index.css). */
const EXIT_ANIMATION_MS = 140;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function FloatingChatPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const floatingChatSessionId = useUIStore((state) => state.floatingChatSessionId);
  const rect = useUIStore((state) => state.floatingChatRect);
  const setRect = useUIStore((state) => state.setFloatingChatRect);
  const dockFloatingChat = useUIStore((state) => state.dockFloatingChat);
  const closeFloatingChat = useUIStore((state) => state.closeFloatingChat);
  const sessions = useChatStore((state) => state.sessions);

  const sessionName = useMemo(
    () => sessions.find((session) => session.id === floatingChatSessionId)?.name,
    [floatingChatSessionId, sessions],
  );

  // 퇴장 애니메이션 → 실제 dock/close 순서로 진행한다. 도킹 즉시 언마운트하면
  // 패널이 순간이동하듯 사라져서 어디로 갔는지 읽히지 않는다.
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  const runExit = useCallback((commit: () => void) => {
    if (exitTimerRef.current !== null) return;
    if (prefersReducedMotion()) {
      commit();
      return;
    }
    setExiting(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      commit();
    }, EXIT_ANIMATION_MS);
  }, []);

  // 새 세션으로 다시 분리되면 퇴장 상태를 초기화한다.
  useEffect(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExiting(false);
  }, [floatingChatSessionId]);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  const handleDock = useCallback(() => runExit(dockFloatingChat), [runExit, dockFloatingChat]);
  const handleClose = useCallback(() => runExit(closeFloatingChat), [runExit, closeFloatingChat]);

  const getBounds = useCallback((): { width: number; height: number } | null => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return null;
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width <= 0 || parentRect.height <= 0) return null;
    return { width: parentRect.width, height: parentRect.height };
  }, []);

  const clampAndSetRect = useCallback((nextRect: FloatingChatRect) => {
    const bounds = getBounds();
    if (!bounds) return;
    const clamped = clampFloatingChatRect(nextRect, bounds);
    if (!rectEquals(clamped, useUIStore.getState().floatingChatRect)) {
      setRect(clamped);
    }
  }, [getBounds, setRect]);

  useEffect(() => {
    if (!floatingChatSessionId) return;

    const syncToBounds = () => clampAndSetRect(useUIStore.getState().floatingChatRect);
    syncToBounds();
    window.addEventListener('resize', syncToBounds);

    const parent = panelRef.current?.parentElement;
    const observer = parent ? new ResizeObserver(syncToBounds) : null;
    if (parent && observer) observer.observe(parent);

    return () => {
      window.removeEventListener('resize', syncToBounds);
      observer?.disconnect();
    };
  }, [clampAndSetRect, floatingChatSessionId]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      if (interaction.type === 'drag') {
        clampAndSetRect({
          ...interaction.startRect,
          x: interaction.startRect.x + deltaX,
          y: interaction.startRect.y + deltaY,
        });
        return;
      }

      const bounds = getBounds();
      if (!bounds) return;
      const resized = resizeFloatingChatRect(
        interaction.startRect,
        interaction.direction,
        deltaX,
        deltaY,
        bounds,
      );
      if (!rectEquals(resized, useUIStore.getState().floatingChatRect)) {
        setRect(resized);
      }
    };

    const handleMouseUp = () => {
      interactionRef.current = null;
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [clampAndSetRect, getBounds, setRect]);

  const beginDrag = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    interactionRef.current = {
      type: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      startRect: useUIStore.getState().floatingChatRect,
    };
    document.body.style.userSelect = 'none';
  }, []);

  const beginResize = useCallback((direction: FloatingChatResizeDirection, event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      type: 'resize',
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startRect: useUIStore.getState().floatingChatRect,
    };
    document.body.style.userSelect = 'none';
  }, []);

  if (!floatingChatSessionId) return null;

  return (
    <div
      ref={panelRef}
      data-testid="floating-chat-panel"
      className={`absolute z-40 flex flex-col overflow-hidden rounded-xl border border-editor-border bg-editor-bg shadow-2xl ${exiting ? 'floating-panel-exit' : 'floating-panel-enter'}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div
        data-testid="floating-chat-drag-handle"
        className="h-10 shrink-0 cursor-move select-none border-b border-editor-border bg-editor-surface flex items-center gap-2 px-3"
        onMouseDown={beginDrag}
        onDoubleClick={handleDock}
      >
        <GripHorizontal size={16} className="shrink-0 text-editor-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-editor-text">
          {sessionName ?? t('chat.title')}
        </span>
        <button
          type="button"
          data-testid="floating-chat-dock"
          className="rounded p-1.5 text-editor-muted transition-colors hover:bg-editor-border hover:text-editor-text"
          title={t('chat.dockPanel', 'Dock chat')}
          aria-label={t('chat.dockPanel', 'Dock chat')}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={handleDock}
        >
          <PanelRightOpen size={16} />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-editor-muted transition-colors hover:bg-editor-border hover:text-editor-text"
          title={t('chat.closeFloatingPanel', 'Close floating chat')}
          aria-label={t('chat.closeFloatingPanel', 'Close floating chat')}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={handleClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 flex flex-col">
        <ChatContent sessionId={floatingChatSessionId} />
      </div>

      {RESIZE_HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          data-testid={`floating-chat-resize-${direction}`}
          role="separator"
          aria-label={t('chat.resizeFloatingPanel', 'Resize chat panel')}
          className={className}
          onMouseDown={(event) => beginResize(direction, event)}
        >
          {direction === 'se' && (
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-editor-muted/70" />
          )}
        </div>
      ))}
    </div>
  );
}
