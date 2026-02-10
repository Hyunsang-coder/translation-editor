import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import type { PanelType, SidebarSide } from '@/types';

// ============================================
// Module-level shared state (cross-instance)
// ============================================

interface DragState {
  panelType: PanelType;
  sourceSide: SidebarSide;
  startX: number;
  startY: number;
  isDragging: boolean;
  sourceLabel: string;
}

interface DropIndicator {
  side: SidebarSide;
  index: number;
}

let dragState: DragState | null = null;
const sidebarRefs: Record<SidebarSide, HTMLElement | null> = { left: null, right: null };
let ghostElement: HTMLDivElement | null = null;
let suppressNextClick = false;

const DRAG_THRESHOLD = 5;

// Cross-instance event emitter for drop indicator
type IndicatorListener = (indicator: DropIndicator | null) => void;
const indicatorListeners = new Set<IndicatorListener>();

function notifyIndicator(indicator: DropIndicator | null): void {
  for (const listener of indicatorListeners) {
    listener(indicator);
  }
}

// ============================================
// Ghost element helpers
// ============================================

function createGhost(label: string): void {
  if (ghostElement) return;
  const el = document.createElement('div');
  el.textContent = label;
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '10000',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    background: 'var(--color-editor-surface, #2d2d2d)',
    color: 'var(--color-editor-text, #e0e0e0)',
    border: '1px solid var(--color-primary-500, #6366f1)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    opacity: '0.9',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(el);
  ghostElement = el;
}

function moveGhost(x: number, y: number): void {
  if (!ghostElement) return;
  ghostElement.style.left = `${x + 12}px`;
  ghostElement.style.top = `${y - 8}px`;
}

function removeGhost(): void {
  if (ghostElement) {
    ghostElement.remove();
    ghostElement = null;
  }
}

// ============================================
// Hit-test helpers
// ============================================

function getTargetSide(clientX: number, clientY: number): SidebarSide | null {
  for (const side of ['left', 'right'] as const) {
    const el = sidebarRefs[side];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return side;
    }
  }
  return null;
}

function calcInsertionIndex(targetSide: SidebarSide, clientX: number): number {
  const container = sidebarRefs[targetSide];
  if (!container) return 0;
  const tabs = container.querySelectorAll<HTMLElement>('[data-panel-tab]');
  if (tabs.length === 0) return 0;

  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]!.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (clientX < midX) return i;
  }
  return tabs.length;
}

// ============================================
// Document-level mouse handlers (registered once)
// ============================================

let documentListenersAttached = false;
let instanceCount = 0;

function handleDocumentMouseMove(e: MouseEvent): void {
  if (!dragState) return;

  if (!dragState.isDragging) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragState.isDragging = true;
    createGhost(dragState.sourceLabel);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  moveGhost(e.clientX, e.clientY);

  const targetSide = getTargetSide(e.clientX, e.clientY);
  if (targetSide) {
    const index = calcInsertionIndex(targetSide, e.clientX);
    notifyIndicator({ side: targetSide, index });
  } else {
    notifyIndicator(null);
  }
}

function handleDocumentMouseUp(e: MouseEvent): void {
  if (!dragState) return;
  const state = dragState;
  const wasDragging = state.isDragging;
  dragState = null;

  removeGhost();
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  notifyIndicator(null);

  if (!wasDragging) return;

  // Suppress the click that follows mouseup
  suppressNextClick = true;
  requestAnimationFrame(() => {
    // Reset after current event cycle
    setTimeout(() => { suppressNextClick = false; }, 0);
  });

  const targetSide = getTargetSide(e.clientX, e.clientY);
  if (!targetSide) return; // Dropped outside any sidebar → cancel

  const store = useUIStore.getState();
  const insertIndex = calcInsertionIndex(targetSide, e.clientX);

  if (state.sourceSide === targetSide) {
    // Same sidebar → reorder
    store.reorderPanel(targetSide, state.panelType, insertIndex);
  } else {
    // Cross-sidebar → move then reorder
    store.movePanel(state.panelType, state.sourceSide, targetSide);
    // After movePanel, panel is appended at end. Reorder to insertion index.
    store.reorderPanel(targetSide, state.panelType, insertIndex);
  }
}

function handleDocumentMouseLeave(e: MouseEvent): void {
  // Cancel drag when cursor leaves the window
  if (e.target === document.documentElement && dragState?.isDragging) {
    dragState = null;
    removeGhost();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    notifyIndicator(null);
  }
}

function attachDocumentListeners(): void {
  if (documentListenersAttached) return;
  document.addEventListener('mousemove', handleDocumentMouseMove);
  document.addEventListener('mouseup', handleDocumentMouseUp);
  document.documentElement.addEventListener('mouseleave', handleDocumentMouseLeave);
  documentListenersAttached = true;
}

function detachDocumentListeners(): void {
  if (!documentListenersAttached) return;
  document.removeEventListener('mousemove', handleDocumentMouseMove);
  document.removeEventListener('mouseup', handleDocumentMouseUp);
  document.documentElement.removeEventListener('mouseleave', handleDocumentMouseLeave);
  documentListenersAttached = false;
}

// ============================================
// Hook
// ============================================

interface UsePanelDragOptions {
  side: SidebarSide;
}

interface UsePanelDragReturn {
  handleTabMouseDown: (panel: PanelType, label: string, e: React.MouseEvent) => void;
  sidebarRef: (el: HTMLElement | null) => void;
  draggingPanel: PanelType | null;
  dropIndicator: DropIndicator | null;
  dragOverSide: SidebarSide | null;
  isClickSuppressed: () => boolean;
}

export function usePanelDrag({ side }: UsePanelDragOptions): UsePanelDragReturn {
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [draggingPanel, setDraggingPanel] = useState<PanelType | null>(null);
  const [dragOverSide, setDragOverSide] = useState<SidebarSide | null>(null);

  // Register/unregister document listeners and indicator subscription
  useEffect(() => {
    instanceCount++;
    attachDocumentListeners();

    const listener: IndicatorListener = (indicator) => {
      setDropIndicator(indicator?.side === side ? indicator : null);
      setDragOverSide(indicator?.side ?? null);
    };
    indicatorListeners.add(listener);

    // Poll dragState for draggingPanel reactivity
    const interval = setInterval(() => {
      const ds = dragState;
      setDraggingPanel(ds?.isDragging && ds.sourceSide === side ? ds.panelType : null);
    }, 50);

    return () => {
      instanceCount--;
      if (instanceCount === 0) detachDocumentListeners();
      indicatorListeners.delete(listener);
      clearInterval(interval);
    };
  }, [side]);

  // Ref callback to register sidebar DOM element
  const sidebarRefStable = useRef<SidebarSide>(side);
  sidebarRefStable.current = side;

  const sidebarRef = useCallback((el: HTMLElement | null) => {
    sidebarRefs[sidebarRefStable.current] = el;
  }, []);

  const handleTabMouseDown = useCallback(
    (panel: PanelType, label: string, e: React.MouseEvent) => {
      // Only left click
      if (e.button !== 0) return;
      // Ignore if clicking close button or other buttons
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;

      dragState = {
        panelType: panel,
        sourceSide: side,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        sourceLabel: label,
      };
    },
    [side],
  );

  const isClickSuppressed = useCallback(() => suppressNextClick, []);

  return {
    handleTabMouseDown,
    sidebarRef,
    draggingPanel,
    dropIndicator,
    dragOverSide,
    isClickSuppressed,
  };
}
