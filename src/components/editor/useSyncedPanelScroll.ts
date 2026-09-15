import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { TranslationUnitDocument } from '@/editor/extensions/TranslationUnitId';
import {
  buildAlignedUnitMaps,
  resolveCounterpartScrollTop,
  type AlignedUnitMaps,
} from '@/editor/utils/alignedPanelScroll';
import { isPanelScrollSyncSuppressed } from '@/editor/utils/panelScrollSyncController';

export type EditorPanelSide = 'source' | 'target';

interface CachedAlignment {
  sourceDoc: ProseMirrorNode;
  targetDoc: ProseMirrorNode;
  maps: AlignedUnitMaps;
  sourceElements: Map<string, HTMLElement>;
  targetElements: Map<string, HTMLElement>;
  sourceOrderedElements: HTMLElement[];
  targetOrderedElements: HTMLElement[];
}

export interface UseSyncedPanelScrollOptions {
  enabled: boolean;
  sourceEditor: Editor | null;
  targetEditor: Editor | null;
  editorZoom: number;
  /** 패널 폭 변경 완료 시 증가하는 nonce */
  layoutRevision: number;
  sourceFontSize: number;
  sourceLineHeight: number;
  targetFontSize: number;
  targetLineHeight: number;
  onBeforeFollowerScroll?: (side: EditorPanelSide) => void;
}

export interface SyncedPanelScrollHandle {
  /** 레이아웃/설정 변경 후 현재 기준 패널을 한 번 다시 맞춘다. */
  requestSync: (primary?: EditorPanelSide) => void;
}

const DOCUMENT_RESYNC_DEBOUNCE_MS = 200;
const TOP_BOTTOM_EPSILON_PX = 2;
const PROBE_OFFSETS = [4, 16, 48, 96, 160] as const;

function liveEditor(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed ? editor : null;
}

function getScrollContainer(editor: Editor): HTMLElement {
  let current: HTMLElement | null = editor.view.dom as HTMLElement;
  while (current) {
    const { overflow, overflowY } = getComputedStyle(current);
    if (/(auto|scroll)/.test(`${overflow} ${overflowY}`)) return current;
    current = current.parentElement;
  }
  return editor.view.dom as HTMLElement;
}

function unitElements(container: HTMLElement): {
  byId: Map<string, HTMLElement>;
  ordered: HTMLElement[];
} {
  const ordered = Array.from(
    container.querySelectorAll<HTMLElement>('[data-translation-unit-id]'),
  );
  const byId = new Map<string, HTMLElement>();
  const duplicates = new Set<string>();

  for (const element of ordered) {
    const id = element.getAttribute('data-translation-unit-id');
    if (!id) continue;
    if (byId.has(id)) {
      byId.delete(id);
      duplicates.add(id);
      continue;
    }
    if (!duplicates.has(id)) byId.set(id, element);
  }

  return { byId, ordered };
}

function elementUnitId(element: Element | null): string | null {
  const unit = element?.closest?.('[data-translation-unit-id]');
  const id = unit?.getAttribute('data-translation-unit-id');
  return id || null;
}

function findVisibleMappedUnit(
  container: HTMLElement,
  orderedElements: HTMLElement[],
  counterpartById: Map<string, string>,
): HTMLElement | null {
  const rect = container.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0 && typeof document.elementFromPoint === 'function') {
    const x = rect.left + Math.min(Math.max(12, rect.width / 2), rect.width - 2);
    for (const offset of PROBE_OFFSETS) {
      if (rect.top + offset >= rect.bottom) break;
      const id = elementUnitId(document.elementFromPoint(x, rect.top + offset));
      if (!id || !counterpartById.has(id)) continue;
      const element = orderedElements.find(
        (candidate) => candidate.getAttribute('data-translation-unit-id') === id,
      );
      if (element) return element;
    }
  }

  // 화면 최상단에 불일치 유닛이 있으면, 그 아래의 첫 번째 대응 유닛을 쓴다.
  for (const element of orderedElements) {
    const elementRect = element.getBoundingClientRect();
    if (elementRect.bottom <= rect.top) continue;
    if (elementRect.top >= rect.bottom) break;
    const id = element.getAttribute('data-translation-unit-id');
    if (id && counterpartById.has(id)) return element;
  }

  return null;
}

function isAtTop(container: HTMLElement): boolean {
  return container.scrollTop <= TOP_BOTTOM_EPSILON_PX;
}

function isAtBottom(container: HTMLElement): boolean {
  return (
    container.scrollTop + container.clientHeight
    >= container.scrollHeight - TOP_BOTTOM_EPSILON_PX
  );
}

/**
 * 원문/번역문을 양방향으로 스크롤 동기화한다.
 *
 * 절대 scrollTop을 복사하지 않는다. 대응 translation unit을 기준으로 상대 패널의
 * 같은 viewport offset을 맞춘다. 이는 언어별 줄바꿈·글꼴·표 높이가 다를 수 있는
 * 번역 에디터에서 유일하게 안정적인 방식이다.
 */
export function useSyncedPanelScroll({
  enabled,
  sourceEditor,
  targetEditor,
  editorZoom,
  layoutRevision,
  sourceFontSize,
  sourceLineHeight,
  targetFontSize,
  targetLineHeight,
  onBeforeFollowerScroll,
}: UseSyncedPanelScrollOptions): SyncedPanelScrollHandle {
  const cacheRef = useRef<CachedAlignment | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingPrimaryRef = useRef<EditorPanelSide | null>(null);
  const applyingFollowerRef = useRef<EditorPanelSide | null>(null);
  const leaderRef = useRef<EditorPanelSide>('source');
  const documentTimerRef = useRef<number | null>(null);
  const onBeforeFollowerScrollRef = useRef(onBeforeFollowerScroll);
  onBeforeFollowerScrollRef.current = onBeforeFollowerScroll;

  const getEditors = useCallback((): {
    source: Editor;
    target: Editor;
  } | null => {
    const source = liveEditor(sourceEditor);
    const target = liveEditor(targetEditor);
    return source && target ? { source, target } : null;
  }, [sourceEditor, targetEditor]);

  const getCache = useCallback((
    source: Editor,
    target: Editor,
  ): CachedAlignment => {
    const previous = cacheRef.current;
    if (
      previous
      && previous.sourceDoc === source.state.doc
      && previous.targetDoc === target.state.doc
    ) {
      return previous;
    }

    const sourceContainer = getScrollContainer(source);
    const targetContainer = getScrollContainer(target);
    const sourceUnits = unitElements(sourceContainer);
    const targetUnits = unitElements(targetContainer);
    const maps = buildAlignedUnitMaps(
      source.getJSON() as TranslationUnitDocument,
      target.getJSON() as TranslationUnitDocument,
    );
    const next: CachedAlignment = {
      sourceDoc: source.state.doc,
      targetDoc: target.state.doc,
      maps,
      sourceElements: sourceUnits.byId,
      targetElements: targetUnits.byId,
      sourceOrderedElements: sourceUnits.ordered,
      targetOrderedElements: targetUnits.ordered,
    };
    cacheRef.current = next;
    return next;
  }, []);

  const releaseFollower = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyingFollowerRef.current = null;
      });
    });
  }, []);

  const syncNow = useCallback((primary: EditorPanelSide): void => {
    if (!enabled || isPanelScrollSyncSuppressed()) return;
    const editors = getEditors();
    if (!editors) return;

    const primaryEditor = primary === 'source' ? editors.source : editors.target;
    const followerSide: EditorPanelSide = primary === 'source' ? 'target' : 'source';
    const followerEditor = followerSide === 'source' ? editors.source : editors.target;
    const primaryContainer = getScrollContainer(primaryEditor);
    const followerContainer = getScrollContainer(followerEditor);

    let nextTop: number | null = null;
    if (isAtTop(primaryContainer)) {
      nextTop = 0;
    } else if (isAtBottom(primaryContainer)) {
      nextTop = Math.max(0, followerContainer.scrollHeight - followerContainer.clientHeight);
    } else {
      const cache = getCache(editors.source, editors.target);
      const counterpartById = primary === 'source'
        ? cache.maps.sourceToTarget
        : cache.maps.targetToSource;
      const primaryElements = primary === 'source'
        ? cache.sourceOrderedElements
        : cache.targetOrderedElements;
      const followerElements = followerSide === 'source'
        ? cache.sourceElements
        : cache.targetElements;
      const primaryUnit = findVisibleMappedUnit(
        primaryContainer,
        primaryElements,
        counterpartById,
      );
      const primaryId = primaryUnit?.getAttribute('data-translation-unit-id') ?? null;
      const counterpartId = primaryId ? counterpartById.get(primaryId) : null;
      const counterpartUnit = counterpartId ? followerElements.get(counterpartId) : null;
      if (!primaryUnit || !counterpartUnit) return;

      nextTop = resolveCounterpartScrollTop({
        counterpartTop: counterpartUnit.getBoundingClientRect().top,
        counterpartContainerTop: followerContainer.getBoundingClientRect().top,
        counterpartScrollTop: followerContainer.scrollTop,
        counterpartScrollHeight: followerContainer.scrollHeight,
        counterpartClientHeight: followerContainer.clientHeight,
        primaryViewportOffset:
          primaryUnit.getBoundingClientRect().top
          - primaryContainer.getBoundingClientRect().top,
        zoom: editorZoom,
      });
    }

    if (
      nextTop === null
      || Math.abs(nextTop - followerContainer.scrollTop) < 1
    ) {
      return;
    }

    onBeforeFollowerScrollRef.current?.(followerSide);
    applyingFollowerRef.current = followerSide;
    followerContainer.scrollTop = nextTop;
    releaseFollower();
  }, [editorZoom, enabled, getCache, getEditors, releaseFollower]);

  const requestSync = useCallback((primary?: EditorPanelSide): void => {
    if (!enabled) return;
    pendingPrimaryRef.current = primary ?? leaderRef.current;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const nextPrimary = pendingPrimaryRef.current;
      pendingPrimaryRef.current = null;
      if (nextPrimary) syncNow(nextPrimary);
    });
  }, [enabled, syncNow]);

  useEffect(() => {
    if (!enabled) return undefined;
    const editors = getEditors();
    if (!editors) return undefined;

    const onScroll = (side: EditorPanelSide): void => {
      if (applyingFollowerRef.current === side) return;
      leaderRef.current = side;
      requestSync(side);
    };
    const sourceContainer = getScrollContainer(editors.source);
    const targetContainer = getScrollContainer(editors.target);
    const sourceScroll = (): void => onScroll('source');
    const targetScroll = (): void => onScroll('target');
    sourceContainer.addEventListener('scroll', sourceScroll, { passive: true });
    targetContainer.addEventListener('scroll', targetScroll, { passive: true });

    const preferredLeaderForDocumentChange = (changed: EditorPanelSide): EditorPanelSide => {
      if (editors.source.isFocused) return 'source';
      if (editors.target.isFocused) return 'target';
      // 한쪽 문서가 프로그램으로 교체됐을 때는 바뀌지 않은 쪽을 기준으로 잡는다.
      return changed === 'source' ? 'target' : 'source';
    };
    const onTransaction = (side: EditorPanelSide) => (
      { transaction }: { transaction: Transaction },
    ): void => {
      if (!transaction.docChanged) return;
      cacheRef.current = null;
      if (documentTimerRef.current !== null) {
        window.clearTimeout(documentTimerRef.current);
      }
      documentTimerRef.current = window.setTimeout(() => {
        documentTimerRef.current = null;
        requestSync(preferredLeaderForDocumentChange(side));
      }, DOCUMENT_RESYNC_DEBOUNCE_MS);
    };
    const sourceTransaction = onTransaction('source');
    const targetTransaction = onTransaction('target');
    editors.source.on('transaction', sourceTransaction);
    editors.target.on('transaction', targetTransaction);

    return () => {
      sourceContainer.removeEventListener('scroll', sourceScroll);
      targetContainer.removeEventListener('scroll', targetScroll);
      editors.source.off('transaction', sourceTransaction);
      editors.target.off('transaction', targetTransaction);
      if (documentTimerRef.current !== null) {
        window.clearTimeout(documentTimerRef.current);
        documentTimerRef.current = null;
      }
    };
  }, [enabled, getEditors, requestSync]);

  useEffect(() => {
    if (!enabled) return undefined;
    const editors = getEditors();
    if (!editors || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => requestSync());
    observer.observe(getScrollContainer(editors.source));
    observer.observe(getScrollContainer(editors.target));
    return () => observer.disconnect();
  }, [enabled, getEditors, requestSync]);

  // 폭·폰트·줄간격·zoom이 바뀌면 스크롤 이벤트 없이 문단 높이가 바뀔 수 있다.
  useEffect(() => {
    if (!enabled) return undefined;
    const frame = requestAnimationFrame(() => requestSync());
    return () => cancelAnimationFrame(frame);
  }, [
    editorZoom,
    enabled,
    layoutRevision,
    requestSync,
    sourceFontSize,
    sourceLineHeight,
    targetFontSize,
    targetLineHeight,
  ]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return { requestSync };
}
