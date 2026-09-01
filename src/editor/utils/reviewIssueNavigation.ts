/**
 * 검수 이슈 → 원문·번역문 패널 위치 이동.
 *
 * 두 패널에 같은 `scrollTop`을 복사하지 않는다. 원문과 번역문은 줄바꿈·글꼴·표 구조가
 * 달라 전체 좌표를 1:1로 맞추는 것이 원리적으로 불가능하므로, **각 패널에서 이슈에
 * 대응하는 앵커를 따로 찾아 각자의 스크롤 컨테이너 상단으로 보낸다.**
 *
 * 위치를 확신할 수 없으면 이동하지 않는다(fail-closed) — 엉뚱한 문장을 보여주느니
 * 현재 위치를 유지하는 편이 안전하다. `resolveSuggestionRange`의 fuzzy 경로는
 * 쓰지 않는다: 그것은 "교체할 범위"를 정하는 로직이라 suggestedFix 길이가 위치를
 * 바꾸는데, 단순 이동에는 그런 의존이 있어선 안 된다.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import type { ReviewIssue } from '@/stores/reviewStore';
import type { TranslationUnitDocument } from '@/editor/extensions/TranslationUnitId';
import { findExcerptRange, findUnitIdContainingExcerpt } from '@/components/review/reviewApply';
import { findAlignedCounterpartUnitMap } from '@/editor/utils/alignedCounterpartUnits';

export type ReviewAnchorSide = 'source' | 'target';

/** `exact-range`가 항상 우선. `unit-range`는 발췌문을 직접 못 찾았을 때만 쓴다. */
export type ReviewAnchorKind = 'exact-range' | 'unit-range' | 'none';

export interface ReviewIssueAnchor {
  side: ReviewAnchorSide;
  kind: ReviewAnchorKind;
  /** 스크롤 기준 위치. `none`이면 없다. */
  range?: { from: number; to: number };
  /** 좌표 계산 실패 시 DOM 폴백에 쓸 유닛 ID */
  unitId?: string;
}

export interface ReviewIssueNavigation {
  issueId: string;
  source: ReviewIssueAnchor;
  target: ReviewIssueAnchor;
  /** 의미상 이슈를 대표하는 쪽. 좌표는 양쪽을 독립 계산하며 이 값에 좌우되지 않는다. */
  primarySide: ReviewAnchorSide;
}

export interface ReviewIssueNavigationInput {
  issue: ReviewIssue;
  /** 라이브 에디터의 문서. 패널이 없으면 null — 그쪽은 `none`이 된다. */
  sourceDoc: ProseMirrorNode | null;
  targetDoc: ProseMirrorNode | null;
  /**
   * 원문 에디터가 없을 때(원문 숨김 모드) 대응 매핑에만 쓰는 스냅샷.
   * 생략하면 `sourceDoc`에서 만든다.
   */
  sourceDocJson?: TranslationUnitDocument | null;
  targetDocJson?: TranslationUnitDocument | null;
}

function noAnchor(side: ReviewAnchorSide): ReviewIssueAnchor {
  return { side, kind: 'none' };
}

/**
 * 문서 JSON은 폴백 경로(유닛 대응)에서만 쓴다. 양쪽 정확 매치로 끝나는 흔한 경우까지
 * 두 문서를 통째로 직렬화하지 않도록 실제 호출 시점에 한 번만 만든다.
 */
function lazyJson(
  provided: TranslationUnitDocument | null | undefined,
  doc: ProseMirrorNode | null,
): () => TranslationUnitDocument | null {
  if (provided !== undefined) return () => provided;

  let cached: TranslationUnitDocument | null | undefined;
  return () => {
    if (cached === undefined) cached = doc ? (doc.toJSON() as TranslationUnitDocument) : null;
    return cached;
  };
}

/**
 * 범위를 감싸는 가장 안쪽 translation unit ID.
 * (표 셀은 셀과 안쪽 문단이 둘 다 걸리므로 더 깊은 쪽을 남긴다)
 */
export function findUnitIdAtRange(
  doc: ProseMirrorNode,
  range: { from: number; to: number },
): string | null {
  let found: string | null = null;
  let foundSize = Number.POSITIVE_INFINITY;

  doc.descendants((node, pos) => {
    const id = node.attrs?.translationUnitId;
    if (typeof id !== 'string' || !id) return undefined;
    if (pos > range.from || pos + node.nodeSize < range.to) return undefined;
    if (node.nodeSize < foundSize) {
      found = id;
      foundSize = node.nodeSize;
    }
    return undefined;
  });

  return found;
}

/** 같은 ID를 가진 노드들(분할된 반쪽 포함)을 모두 덮는 문서 범위. */
export function findUnitRange(
  doc: ProseMirrorNode,
  unitId: string,
): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  doc.descendants((node, pos) => {
    if (node.attrs?.translationUnitId === unitId) {
      from = Math.min(from, pos);
      to = Math.max(to, pos + node.nodeSize);
    }
    return undefined;
  });

  return Number.isFinite(from) && to > from ? { from, to } : null;
}

/**
 * 반대쪽 유닛 ID로 이쪽 유닛을 찾는다. 부분·모호 매핑은 `findAlignedCounterpartUnitMap`이
 * 이미 fail-closed로 거르고, 여기서 고유 ID 하나로 좁혀지지 않으면 한 번 더 포기한다.
 */
function findCounterpartUnitId(
  ownDocJson: TranslationUnitDocument | null,
  counterpartDocJson: TranslationUnitDocument | null,
  counterpartUnitId: string,
): string | null {
  if (!ownDocJson || !counterpartDocJson) return null;

  const byUnitId = findAlignedCounterpartUnitMap(
    ownDocJson,
    counterpartDocJson,
    [counterpartUnitId],
  );

  const units = byUnitId?.get(counterpartUnitId) ?? [];
  if (units.length === 0) return null;

  const ids = new Set(units.map((unit) => unit.id));
  // ID 없는 유닛이 섞여 있으면(레거시 문서) 어느 쪽이 짝인지 확신할 수 없다.
  if (ids.size !== 1) return null;
  const [id] = ids;
  return id ?? null;
}

function buildAnchor(
  side: ReviewAnchorSide,
  doc: ProseMirrorNode | null,
  exactRange: { from: number; to: number } | null,
  ownUnitId: string | null,
  counterpartUnitId: string | null,
  ownDocJson: () => TranslationUnitDocument | null,
  counterpartDocJson: () => TranslationUnitDocument | null,
): ReviewIssueAnchor {
  if (!doc) return noAnchor(side);

  if (exactRange) {
    return {
      side,
      kind: 'exact-range',
      range: exactRange,
      ...(ownUnitId ? { unitId: ownUnitId } : {}),
    };
  }

  // 발췌문은 못 찾았지만 그 발췌문이 든 유닛이 이 문서에서 고유하면 유닛 상단으로 간다.
  // (여러 노드에 걸친 구절, 편집으로 살짝 달라진 구절)
  const unitId = ownUnitId
    ?? (counterpartUnitId
      ? findCounterpartUnitId(ownDocJson(), counterpartDocJson(), counterpartUnitId)
      : null);
  if (!unitId) return noAnchor(side);

  const range = findUnitRange(doc, unitId);
  if (!range) return noAnchor(side);
  return { side, kind: 'unit-range', range, unitId };
}

/**
 * 이슈 하나에 대해 원문·번역문 앵커를 각각 계산한다.
 *
 * - 양쪽 발췌문이 다 있는 일반 이슈: 각 패널에서 정확 매치를 따로 찾는다.
 * - 한쪽 발췌문이 없는 누락/추가 이슈: 텍스트가 있는 쪽을 기준으로 삼고,
 *   반대쪽은 대응 유닛이 확실할 때만 이동한다.
 */
export function resolveReviewIssueNavigation(
  input: ReviewIssueNavigationInput,
): ReviewIssueNavigation {
  const { issue, sourceDoc, targetDoc } = input;
  const sourceDocJson = lazyJson(input.sourceDocJson, sourceDoc);
  const targetDocJson = lazyJson(input.targetDocJson, targetDoc);

  const targetRange = targetDoc
    ? findExcerptRange(targetDoc, issue.targetExcerpt, issue.segmentGroupId)
    : null;
  const sourceRange = sourceDoc
    ? findExcerptRange(sourceDoc, issue.sourceExcerpt, issue.segmentGroupId)
    : null;

  // 범위를 찾았으면 그 범위가 든 유닛이 가장 정확하다. 못 찾았으면 문서 JSON에서
  // 발췌문이 고유하게 들어 있는 유닛을 찾는다(에디터가 없는 숨김 패널도 가능).
  const targetUnitId = targetDoc && targetRange
    ? findUnitIdAtRange(targetDoc, targetRange)
    : findUnitIdContainingExcerpt(targetDocJson(), issue.targetExcerpt);
  const sourceUnitId = sourceDoc && sourceRange
    ? findUnitIdAtRange(sourceDoc, sourceRange)
    : findUnitIdContainingExcerpt(sourceDocJson(), issue.sourceExcerpt);

  return {
    issueId: issue.id,
    source: buildAnchor(
      'source', sourceDoc, sourceRange, sourceUnitId, targetUnitId, sourceDocJson, targetDocJson,
    ),
    target: buildAnchor(
      'target', targetDoc, targetRange, targetUnitId, sourceUnitId, targetDocJson, sourceDocJson,
    ),
    // 번역문이 의미상의 기본 기준. 번역문 텍스트가 없는 누락 이슈만 원문이 기준이다.
    primarySide: issue.targetExcerpt.trim() ? 'target' : 'source',
  };
}

// ============================================
// 스크롤 계산 (순수) + DOM 어댑터
// ============================================

/** 앵커가 패널 상단 경계에 붙지 않도록 두는 여백 (CSS px) */
export const ANCHOR_TOP_GAP_PX = 12;

/** 이 미만의 이동은 스크롤 이벤트만 만들고 화면은 그대로다 — 호출하지 않는다. */
const MIN_SCROLL_DELTA_PX = 1;

export interface AnchorScrollInput {
  /** 앵커 상단의 화면 좌표 */
  anchorTop: number;
  /** 스크롤 컨테이너 상단의 화면 좌표 */
  containerTop: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** 전역 CSS zoom. 화면 좌표 차이를 콘텐츠 좌표로 되돌리는 데 쓴다. */
  zoom: number;
  topGap?: number;
}

/**
 * 앵커를 컨테이너 상단으로 보내는 `scrollTop`. 이미 그 자리면 null.
 * 문서 시작/끝에서는 스크롤 가능 범위로 clamp한다.
 */
export function resolveAnchorScrollTop(input: AnchorScrollInput): number | null {
  const {
    anchorTop, containerTop, scrollTop, scrollHeight, clientHeight, zoom,
    topGap = ANCHOR_TOP_GAP_PX,
  } = input;

  const effectiveZoom = zoom > 0 ? zoom : 1;
  const scrollDelta = (anchorTop - containerTop - topGap) / effectiveZoom;
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  const next = Math.min(Math.max(scrollTop + scrollDelta, 0), maxTop);

  return Math.abs(next - scrollTop) < MIN_SCROLL_DELTA_PX ? null : next;
}

/**
 * 실제 스크롤 컨테이너. `.tiptap-wrapper .ProseMirror` 자체가
 * `height:100%; overflow:auto`(index.css)이므로 자기 자신부터 확인한다.
 */
export function findScrollContainer(element: HTMLElement): HTMLElement {
  let current: HTMLElement | null = element;
  while (current) {
    const { overflow, overflowY } = getComputedStyle(current);
    if (/(auto|scroll)/.test(`${overflow} ${overflowY}`)) return current;
    current = current.parentElement;
  }
  return element;
}

/** jsdom에는 `Element.scrollTo`가 없다 — 테스트에서도 안전하게 동작시킨다. */
function scrollElementTo(element: HTMLElement, top: number): void {
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top, behavior: 'smooth' });
  } else {
    element.scrollTop = top;
  }
}

function anchorTopInViewport(editor: Editor, anchor: ReviewIssueAnchor): number | null {
  if (anchor.range) {
    try {
      return editor.view.coordsAtPos(anchor.range.from).top;
    } catch {
      // 좌표를 못 얻으면 아래 DOM 폴백으로
    }
  }
  if (!anchor.unitId) return null;
  const unitEl = Array.from(
    (editor.view.dom as HTMLElement).querySelectorAll<HTMLElement>('[data-translation-unit-id]'),
  ).find((el) => el.getAttribute('data-translation-unit-id') === anchor.unitId);
  return unitEl ? unitEl.getBoundingClientRect().top : null;
}

/**
 * 앵커가 패널 상단에 오도록 해당 에디터의 스크롤 컨테이너만 움직인다.
 * `scrollIntoView()`를 쓰지 않는다 — 중첩 컨테이너와 전역 zoom 때문에 직접 계산이 안전하다.
 *
 * @returns 위치를 특정했으면 true (이미 제자리라 스크롤이 필요 없던 경우 포함)
 */
export function scrollEditorToAnchor(
  editor: Editor,
  anchor: ReviewIssueAnchor,
  zoom: number,
): boolean {
  if (anchor.kind === 'none' || editor.isDestroyed) return false;

  const dom = editor.view.dom as HTMLElement;
  // 정렬 오버레이 뒤 등 화면에 붙어 있지 않은 DOM은 좌표를 믿을 수 없다.
  if (!dom.isConnected) return false;

  const anchorTop = anchorTopInViewport(editor, anchor);
  if (anchorTop === null) return false;

  const container = findScrollContainer(dom);
  const nextTop = resolveAnchorScrollTop({
    anchorTop,
    containerTop: container.getBoundingClientRect().top,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    zoom,
  });
  if (nextTop !== null) scrollElementTo(container, nextTop);
  return true;
}

/** 검수 카드 목록처럼 앵커 요소를 이미 아는 컨테이너용. 바깥 패널은 건드리지 않는다. */
export function scrollContainerToElement(
  container: HTMLElement,
  element: HTMLElement,
  zoom: number,
  topGap?: number,
): void {
  const nextTop = resolveAnchorScrollTop({
    anchorTop: element.getBoundingClientRect().top,
    containerTop: container.getBoundingClientRect().top,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    zoom,
    ...(topGap === undefined ? {} : { topGap }),
  });
  if (nextTop !== null) scrollElementTo(container, nextTop);
}
