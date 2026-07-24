import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { v4 as uuidv4 } from 'uuid';
import { pluginKeys } from '@/editor/plugins/pluginKeys';

const MAX_SELECTION_ANCHORS = 5;
const DOCUMENT_REPLACE_META = 'selectionAnchorDocumentReplace';

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
  const currentText = rangeIsValid ? doc.textBetween(from, to) : '';

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

export function normalizeSelectionAnchorRange(
  editor: Editor,
  input: Pick<CreateSelectionAnchorInput, 'from' | 'to'>,
): { from: number; to: number } | null {
  let { from, to } = input;
  const { doc } = editor.state;
  if (
    from === 0 &&
    to === doc.content.size &&
    doc.childCount === 1 &&
    doc.firstChild?.isTextblock
  ) {
    from = 1;
    to = doc.content.size - 1;
  }
  if (from < 0 || to <= from || to > doc.content.size) return null;

  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null;

  // 가장자리 공백은 범위에서 제외한다. SelectionContext.text(트림된 문자열)와
  // anchor.originalText(textBetween 원본)가 어긋나면 proposal 적용 검증이
  // 항상 stale로 판정되므로, 앵커 자체를 트림된 범위로 만든다.
  while (from < to && /^\s$/.test(doc.textBetween(from, from + 1))) from += 1;
  while (to > from && /^\s$/.test(doc.textBetween(to - 1, to))) to -= 1;
  if (to <= from) return null;
  return { from, to };
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
    throw new Error('선택 범위는 하나의 텍스트 블록 안에 있어야 합니다.');
  }
  const { from, to } = range;

  const originalText = editor.state.doc.textBetween(from, to);
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
