import type { FloatingChatRect } from '@/types';

export const FLOATING_CHAT_MIN_WIDTH = 320;
export const FLOATING_CHAT_MIN_HEIGHT = 360;

export type FloatingChatResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface FloatingChatBounds {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampFloatingChatRect(
  rect: FloatingChatRect,
  bounds: FloatingChatBounds,
): FloatingChatRect {
  const boundsWidth = Math.max(0, bounds.width);
  const boundsHeight = Math.max(0, bounds.height);
  const width = Math.min(boundsWidth, Math.max(FLOATING_CHAT_MIN_WIDTH, rect.width));
  const height = Math.min(boundsHeight, Math.max(FLOATING_CHAT_MIN_HEIGHT, rect.height));

  return {
    x: clamp(rect.x, 0, Math.max(0, boundsWidth - width)),
    y: clamp(rect.y, 0, Math.max(0, boundsHeight - height)),
    width,
    height,
  };
}

export function resizeFloatingChatRect(
  rect: FloatingChatRect,
  direction: FloatingChatResizeDirection,
  deltaX: number,
  deltaY: number,
  bounds: FloatingChatBounds,
): FloatingChatRect {
  const boundsWidth = Math.max(0, bounds.width);
  const boundsHeight = Math.max(0, bounds.height);
  const start = clampFloatingChatRect(rect, bounds);
  const minimumWidth = Math.min(FLOATING_CHAT_MIN_WIDTH, boundsWidth);
  const minimumHeight = Math.min(FLOATING_CHAT_MIN_HEIGHT, boundsHeight);

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (direction.includes('w')) {
    left = clamp(start.x + deltaX, 0, right - minimumWidth);
  }
  if (direction.includes('e')) {
    right = clamp(right + deltaX, left + minimumWidth, boundsWidth);
  }
  if (direction.includes('n')) {
    top = clamp(start.y + deltaY, 0, bottom - minimumHeight);
  }
  if (direction.includes('s')) {
    bottom = clamp(bottom + deltaY, top + minimumHeight, boundsHeight);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
