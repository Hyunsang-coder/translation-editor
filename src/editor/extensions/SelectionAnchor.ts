import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { v4 as uuidv4 } from 'uuid';
import { pluginKeys } from '@/editor/plugins/pluginKeys';

const MAX_SELECTION_ANCHORS = 5;
const DOCUMENT_REPLACE_META = 'selectionAnchorDocumentReplace';

/**
 * 앵커 텍스트는 블록 구분자를 포함해 읽는다. 구분자가 없으면 문단 병합·분할이
 * 텍스트를 바꾸지 않아(`One`+`Two`가 병합돼도 `OneTwo`) 구조 변경이 재기준화
 * 텍스트에 드러나지 않는다. `SelectionContext.text`도 같은 기준이어야
 * expectedText 스냅샷 비교(applySelectionEdit)가 맞는다.
 */
const ANCHOR_BLOCK_SEPARATOR = '\n';

export interface SelectionRange {
  from: number;
  to: number;
}

/** 앵커 범위의 텍스트를 재기준화·적용 검증과 같은 기준으로 읽는다 */
export function readAnchorText(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string {
  return doc.textBetween(from, to, ANCHOR_BLOCK_SEPARATOR);
}

/**
 * 여러 범위를 문서 순서대로 이어 읽는다. 표 다중 셀 선택은 셀마다 범위가 하나씩
 * 생기고 그 사이에 선택하지 않은 셀이 낀다 — 하나의 span으로 읽으면 안 고른
 * 셀까지 섞인다.
 */
export function readAnchorRangesText(
  doc: ProseMirrorNode,
  ranges: readonly SelectionRange[],
): string {
  return ranges
    .map((range) => readAnchorText(doc, range.from, range.to))
    .join(ANCHOR_BLOCK_SEPARATOR);
}

export type SelectionAnchorStatus = 'active' | 'stale';

export interface SelectionAnchorRecord {
  anchorId: string;
  /** 선택 범위(문서 순서, 최소 1개). 표 다중 셀 선택은 셀마다 하나씩 들어온다. */
  ranges: SelectionRange[];
  originalText: string;
  status: SelectionAnchorStatus;
  createdAt: number;
}

export interface SelectionAnchorPluginState {
  anchors: Record<string, SelectionAnchorRecord>;
  decorations: DecorationSet;
}

export interface CreateSelectionAnchorInput {
  ranges: readonly SelectionRange[];
  anchorId?: string;
  createdAt?: number;
}

export interface NormalizedSelectionRange extends SelectionRange {
  /** 범위가 실제로 걸친 textblock 수. 1보다 크면 문단을 가로지르는 선택이다. */
  blockCount: number;
}

export interface NormalizedSelectionRanges {
  ranges: SelectionRange[];
  /** 모든 범위가 걸친 textblock 총합. 1보다 크면 적용 경로를 쓸 수 없다. */
  blockCount: number;
}

/**
 * 단일 범위 앵커의 범위를 꺼낸다. 다중 범위(표 셀 선택)는 평문 하나로 교체할
 * 방법이 없으므로 적용 경로에서 null로 걸러낸다.
 */
export function getSingleAnchorRange(
  anchor: SelectionAnchorRecord,
): SelectionRange | null {
  return anchor.ranges.length === 1 ? anchor.ranges[0]! : null;
}

type SelectionAnchorMeta =
  | { type: 'create'; anchor: SelectionAnchorRecord }
  | { type: 'remove'; anchorId: string }
  | { type: 'markStale'; anchorId: string }
  | { type: 'clear' };

function buildDecorations(
  doc: ProseMirrorNode,
  anchors: Record<string, SelectionAnchorRecord>,
): DecorationSet {
  const decorations = Object.values(anchors)
    .filter((anchor) => anchor.status === 'active')
    .flatMap((anchor) =>
      anchor.ranges.map((range) =>
        Decoration.inline(range.from, range.to, {
          class: 'selection-anchor',
          'data-selection-anchor-id': anchor.anchorId,
        }),
      ),
    );

  return DecorationSet.create(doc, decorations);
}

function emptyState(): SelectionAnchorPluginState {
  return {
    anchors: {},
    decorations: DecorationSet.empty,
  };
}

function mapAnchor(
  anchor: SelectionAnchorRecord,
  tr: Transaction,
  doc: ProseMirrorNode,
): SelectionAnchorRecord {
  const ranges = anchor.ranges.map((range) => ({
    from: tr.mapping.map(range.from, 1),
    to: tr.mapping.map(range.to, -1),
  }));
  const rangesAreValid = ranges.every(
    (range) => range.from >= 0 && range.to > range.from && range.to <= doc.content.size,
  );
  const currentText = rangesAreValid ? readAnchorRangesText(doc, ranges) : '';

  // 편집을 따라 originalText를 현재 텍스트로 재기준화한다 — 칩·하이라이트가
  // "이 부분"을 계속 가리키게 하기 위함. 적용 경로의 TOCTOU 가드는 호출부가
  // 넘기는 expectedText 스냅샷이 담당한다(applySelectionEdit 참고).
  // 범위가 붕괴하거나(선택 전체 삭제) 텍스트가 비면 죽은 앵커(stale)로 전환하고
  // undo로 텍스트가 돌아와도 되살리지 않는다.
  if (anchor.status !== 'active' || !currentText) {
    return { ...anchor, ranges, status: 'stale' };
  }
  return { ...anchor, ranges, originalText: currentText };
}

function applyMeta(
  anchors: Record<string, SelectionAnchorRecord>,
  meta: SelectionAnchorMeta | undefined,
): Record<string, SelectionAnchorRecord> {
  if (!meta) return anchors;

  if (meta.type === 'clear') return {};

  const next = { ...anchors };
  if (meta.type === 'remove') {
    delete next[meta.anchorId];
    return next;
  }
  if (meta.type === 'markStale') {
    const anchor = next[meta.anchorId];
    if (anchor) next[meta.anchorId] = { ...anchor, status: 'stale' };
    return next;
  }

  next[meta.anchor.anchorId] = meta.anchor;
  const ordered = Object.values(next).sort((a, b) => a.createdAt - b.createdAt);
  while (ordered.length > MAX_SELECTION_ANCHORS) {
    const oldest = ordered.shift();
    if (oldest) delete next[oldest.anchorId];
  }
  return next;
}

export const SelectionAnchor = Extension.create({
  name: 'selectionAnchor',

  addProseMirrorPlugins() {
    return [
      new Plugin<SelectionAnchorPluginState>({
        key: pluginKeys.selectionAnchor,
        state: {
          init: emptyState,
          apply: (tr, previous, _oldState, newState) => {
            if (tr.getMeta(DOCUMENT_REPLACE_META)) return emptyState();

            let anchors = previous.anchors;
            if (tr.docChanged) {
              anchors = Object.fromEntries(
                Object.values(anchors).map((anchor) => {
                  const mapped = mapAnchor(anchor, tr, newState.doc);
                  return [mapped.anchorId, mapped];
                }),
              );
            }

            anchors = applyMeta(
              anchors,
              tr.getMeta(pluginKeys.selectionAnchor) as SelectionAnchorMeta | undefined,
            );

            return {
              anchors,
              decorations: buildDecorations(newState.doc, anchors),
            };
          },
        },
        props: {
          decorations(state) {
            return pluginKeys.selectionAnchor.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

function getAnchorState(editor: Editor): SelectionAnchorPluginState | undefined {
  return pluginKeys.selectionAnchor.getState(editor.state);
}

function dispatchMeta(editor: Editor, meta: SelectionAnchorMeta): void {
  editor.view.dispatch(editor.state.tr.setMeta(pluginKeys.selectionAnchor, meta));
}

/**
 * 범위가 실제로 덮는 첫/마지막 textblock 내부로 좁힌다.
 *
 * Cmd+A(AllSelection)나 블록 경계에서 시작·끝나는 범위는 끝점의 부모가 doc·listItem
 * 이라 그대로는 텍스트 범위로 쓸 수 없다. 텍스트 기여분이 없는 블록(빈 문단)은
 * 건너뛰므로 앞뒤 빈 문단은 범위에서 빠진다.
 */
function textblockSpan(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): NormalizedSelectionRange | null {
  let start: number | null = null;
  let end: number | null = null;
  let blockCount = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return;
    const blockFrom = Math.max(from, pos + 1);
    const blockTo = Math.min(to, pos + 1 + node.content.size);
    if (blockTo <= blockFrom) return;
    if (start === null) start = blockFrom;
    end = blockTo;
    blockCount += 1;
  });
  if (start === null || end === null || end <= start) return null;
  return { from: start, to: end, blockCount };
}

export function normalizeSelectionAnchorRange(
  editor: Editor,
  input: SelectionRange,
): NormalizedSelectionRange | null {
  const { doc } = editor.state;
  if (input.from < 0 || input.to <= input.from || input.to > doc.content.size) {
    return null;
  }

  const clamped = textblockSpan(doc, input.from, input.to);
  if (!clamped) return null;

  // 가장자리 공백은 범위에서 제외한다. SelectionContext.text(트림된 문자열)와
  // anchor.originalText(readAnchorText 원본)가 어긋나면 proposal 적용 검증이
  // 항상 stale로 판정되므로, 앵커 자체를 트림된 범위로 만든다.
  // (블록 경계에서 textBetween은 ''을 반환하므로 루프는 경계를 넘지 않는다.)
  let { from, to } = clamped;
  while (from < to && /^\s$/.test(doc.textBetween(from, from + 1))) from += 1;
  while (to > from && /^\s$/.test(doc.textBetween(to - 1, to))) to -= 1;
  if (to <= from) return null;

  // 트림으로 앞뒤 블록의 기여분이 공백뿐이었다면 사라지므로 blockCount를 다시 센다.
  return textblockSpan(doc, from, to);
}

/**
 * 여러 범위를 각각 정규화한다. 표 다중 셀 선택(`CellSelection`)은 셀마다 범위가
 * 하나씩 생기므로 하나로 합칠 수 없다 — 합치면 사이에 낀, 고르지 않은 셀이 섞인다.
 * 정규화에서 탈락한 범위(빈 문단 등)는 버린다.
 */
export function normalizeSelectionAnchorRanges(
  editor: Editor,
  inputs: readonly SelectionRange[],
): NormalizedSelectionRanges | null {
  const normalized = inputs
    .map((input) => normalizeSelectionAnchorRange(editor, input))
    .filter((range): range is NormalizedSelectionRange => range !== null)
    .sort((a, b) => a.from - b.from);
  if (normalized.length === 0) return null;

  return {
    ranges: normalized.map(({ from, to }) => ({ from, to })),
    blockCount: normalized.reduce((sum, range) => sum + range.blockCount, 0),
  };
}

export function createSelectionAnchor(
  editor: Editor,
  input: CreateSelectionAnchorInput,
): string {
  const normalized = normalizeSelectionAnchorRanges(editor, input.ranges);
  if (!normalized) {
    throw new Error('선택 범위에서 텍스트를 찾을 수 없습니다.');
  }

  const originalText = readAnchorRangesText(editor.state.doc, normalized.ranges);
  if (!originalText) {
    throw new Error('빈 선택 범위에는 앵커를 만들 수 없습니다.');
  }

  const anchorId = input.anchorId ?? uuidv4();
  dispatchMeta(editor, {
    type: 'create',
    anchor: {
      anchorId,
      ranges: normalized.ranges,
      originalText,
      status: 'active',
      createdAt: input.createdAt ?? Date.now(),
    },
  });
  return anchorId;
}

export function resolveSelectionAnchor(
  editor: Editor,
  anchorId: string,
): SelectionAnchorRecord | null {
  return getAnchorState(editor)?.anchors[anchorId] ?? null;
}

export function removeSelectionAnchor(editor: Editor, anchorId: string): void {
  dispatchMeta(editor, { type: 'remove', anchorId });
}

export function markSelectionAnchorStale(editor: Editor, anchorId: string): void {
  dispatchMeta(editor, { type: 'markStale', anchorId });
}

export function clearSelectionAnchors(editor: Editor): void {
  dispatchMeta(editor, { type: 'clear' });
}
