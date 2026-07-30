import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  getSingleAnchorRange,
  readAnchorText,
  type SelectionAnchorRecord,
} from '@/editor/extensions/SelectionAnchor';
import { pluginKeys } from '@/editor/plugins/pluginKeys';

export type ApplySelectionEditResult = 'applied' | 'stale' | 'invalid';

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

  const tr = editor.state.tr.insertText(replacementText, range.from, range.to);
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
