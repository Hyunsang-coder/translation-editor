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
 * 텍스트를 바꾸지 않아(`One`+`Two`가 병합돼도 `OneTwo`) 구조 변경을 stale로
 * 잡지 못한다. `SelectionContext.text`도 같은 기준이어야 proposal 검증이 맞는다.
 */
const ANCHOR_BLOCK_SEPARATOR = '\n';

/** 앵커 범위의 텍스트를 stale 비교와 같은 기준으로 읽는다 */
export function readAnchorText(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string {
  return doc.textBetween(from, to, ANCHOR_BLOCK_SEPARATOR);
}

export type SelectionAnchorStatus = 'active' | 'stale';

export interface SelectionAnchorRecord {
  anchorId: string;
  from: number;
  to: number;
  originalText: string;
  status: SelectionAnchorStatus;
  createdAt: number;
}

export interface SelectionAnchorPluginState {
  anchors: Record<string, SelectionAnchorRecord>;
  decorations: DecorationSet;
}

export interface CreateSelectionAnchorInput {
  from: number;
  to: number;
  anchorId?: string;
  createdAt?: number;
}

export interface NormalizedSelectionRange {
  from: number;
  to: number;
  /** 범위가 실제로 걸친 textblock 수. 1보다 크면 문단을 가로지르는 선택이다. */
  blockCount: number;
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
    .map((anchor) =>
      Decoration.inline(anchor.from, anchor.to, {
        class: 'selection-anchor',
        'data-selection-anchor-id': anchor.anchorId,
      }),
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
  const from = tr.mapping.map(anchor.from, 1);
  const to = tr.mapping.map(anchor.to, -1);
  const rangeIsValid = from >= 0 && to > from && to <= doc.content.size;
  const currentText = rangeIsValid ? readAnchorText(doc, from, to) : '';

  return {
    ...anchor,
    from,
    to,
    status:
      anchor.status === 'active' && currentText === anchor.originalText
        ? 'active'
        : 'stale',
  };
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
  input: Pick<CreateSelectionAnchorInput, 'from' | 'to'>,
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

export function createSelectionAnchor(
  editor: Editor,
  input: CreateSelectionAnchorInput,
): string {
  const range = normalizeSelectionAnchorRange(editor, input);
  if (!range) {
    const { from, to } = input;
    if (from < 0 || to <= from || to > editor.state.doc.content.size) {
      throw new Error('선택 범위가 유효하지 않습니다.');
    }
    throw new Error('선택 범위에서 텍스트를 찾을 수 없습니다.');
  }
  const { from, to } = range;

  const originalText = readAnchorText(editor.state.doc, from, to);
  if (!originalText) {
    throw new Error('빈 선택 범위에는 앵커를 만들 수 없습니다.');
  }

  const anchorId = input.anchorId ?? uuidv4();
  dispatchMeta(editor, {
    type: 'create',
    anchor: {
      anchorId,
      from,
      to,
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
