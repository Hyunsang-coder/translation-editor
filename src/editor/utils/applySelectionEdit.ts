import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
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
  if (
    editor.isDestroyed ||
    anchor.status !== 'active' ||
    anchor.from < 0 ||
    anchor.to <= anchor.from ||
    anchor.to > editor.state.doc.content.size
  ) {
    return anchor.status === 'stale' ? 'stale' : 'invalid';
  }

  const currentText = readAnchorText(editor.state.doc, anchor.from, anchor.to);
  if (currentText !== anchor.originalText) return 'stale';

  // 멀티블록 범위는 앵커로 만들 수 있지만(참조·하이라이트용) 적용은 못 한다.
  // 평문 하나로 교체하면 문단·리스트 항목이 한 블록으로 뭉개진다.
  const $from = editor.state.doc.resolve(anchor.from);
  const $to = editor.state.doc.resolve(anchor.to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return 'invalid';

  const tr = editor.state.tr.insertText(replacementText, anchor.from, anchor.to);
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      anchor.from,
      anchor.from + replacementText.length,
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
