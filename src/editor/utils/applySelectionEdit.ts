import type { Editor } from '@tiptap/core';
import { Mark } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  getSingleAnchorRange,
  readAnchorText,
  type SelectionAnchorRecord,
} from '@/editor/extensions/SelectionAnchor';
import { pluginKeys } from '@/editor/plugins/pluginKeys';

export type ApplySelectionEditResult =
  | 'applied'
  | 'stale'
  | 'invalid'
  | 'formatting-conflict';

/**
 * 선택 범위의 모든 텍스트 노드가 같은 mark 집합을 쓰는지 확인한다.
 * 서로 다른 mark를 가로지르는 교체를 시작점 mark 하나로 평탄화하면 서식과 코멘트
 * 범위가 조용히 바뀌므로, 직접 재번역에서는 안전하게 거부한다.
 */
export function getUniformSelectionMarks(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): readonly Mark[] | null {
  const range = getSingleAnchorRange(anchor);
  if (!range) return null;

  const markSets: Mark[][] = [];
  editor.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText) return;
    const nodeTo = pos + node.nodeSize;
    if (nodeTo <= range.from || pos >= range.to) return;
    markSets.push([...node.marks]);
  });
  if (markSets.length === 0) return null;
  const first = markSets[0]!;
  return markSets.every((marks) => Mark.sameSet(first, marks)) ? first : null;
}

export function selectionHasUniformFormatting(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): boolean {
  return getUniformSelectionMarks(editor, anchor) !== null;
}

export function applySelectionEdit(
  editor: Editor,
  anchor: SelectionAnchorRecord,
  replacementText: string,
): ApplySelectionEditResult {
  // 다중 범위(표 셀 선택)와 멀티블록 범위는 앵커로 만들 수 있지만(참조·하이라이트용)
  // 적용은 못 한다. 평문 하나로 교체하면 문단·리스트·셀이 한 블록으로 뭉개진다.
  const range = getSingleAnchorRange(anchor);
  if (
    editor.isDestroyed ||
    anchor.status !== 'active' ||
    !range ||
    range.from < 0 ||
    range.to <= range.from ||
    range.to > editor.state.doc.content.size
  ) {
    return anchor.status === 'stale' ? 'stale' : 'invalid';
  }

  const currentText = readAnchorText(editor.state.doc, range.from, range.to);
  if (currentText !== anchor.originalText) return 'stale';

  const $from = editor.state.doc.resolve(range.from);
  const $to = editor.state.doc.resolve(range.to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return 'invalid';

  const marks = getUniformSelectionMarks(editor, anchor);
  if (!marks) return 'formatting-conflict';

  const tr = editor.state.tr;
  if (replacementText) {
    tr.replaceWith(
      range.from,
      range.to,
      editor.schema.text(replacementText, [...marks]),
    );
  } else {
    tr.delete(range.from, range.to);
  }
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      range.from,
      range.from + replacementText.length,
    ),
  );
  tr.setMeta(pluginKeys.selectionAnchor, {
    type: 'remove',
    anchorId: anchor.anchorId,
  });
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return 'applied';
}
