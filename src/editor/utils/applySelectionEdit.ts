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

export interface ApplySelectionEditOptions {
  /**
   * 적용 직전 앵커 텍스트가 이 스냅샷과 같아야 한다. 앵커의 originalText는
   * 편집을 따라 재기준화되므로(SelectionAnchor.mapAnchor) TOCTOU 가드가 되지
   * 못한다 — 수정안·재번역이 만들어진 시점의 텍스트를 호출부가 직접 넘긴다.
   */
  expectedText: string;
  /**
   * 서식이 섞인 범위를 공통 mark(모든 텍스트 노드에 걸린 것만)로 평탄화해 적용한다.
   * 부분 서식이 조용히 사라지므로, 사용자가 "서식이 사라질 수 있다" 확인을 거친
   * 경로에서만 켤 것.
   */
  flattenFormatting?: boolean;
}

function collectSelectionMarkSets(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): Mark[][] | null {
  const range = getSingleAnchorRange(anchor);
  if (!range) return null;

  const markSets: Mark[][] = [];
  editor.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText) return;
    const nodeTo = pos + node.nodeSize;
    if (nodeTo <= range.from || pos >= range.to) return;
    markSets.push([...node.marks]);
  });
  return markSets.length > 0 ? markSets : null;
}

/**
 * 선택 범위의 모든 텍스트 노드가 같은 mark 집합을 쓰는지 확인한다.
 * 서로 다른 mark를 가로지르는 교체를 시작점 mark 하나로 평탄화하면 서식과 코멘트
 * 범위가 조용히 바뀌므로, 기본 경로에서는 거부한다.
 */
export function getUniformSelectionMarks(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): readonly Mark[] | null {
  const markSets = collectSelectionMarkSets(editor, anchor);
  if (!markSets) return null;
  const first = markSets[0]!;
  return markSets.every((marks) => Mark.sameSet(first, marks)) ? first : null;
}

/** 모든 텍스트 노드에 공통으로 걸린 mark만 남긴다 — 평탄화 적용 시 교체 텍스트의 서식. */
function getCommonSelectionMarks(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): readonly Mark[] | null {
  const markSets = collectSelectionMarkSets(editor, anchor);
  if (!markSets) return null;
  return markSets[0]!.filter((mark) => markSets.every((set) => mark.isInSet(set)));
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
  options: ApplySelectionEditOptions,
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
  if (currentText !== options.expectedText) return 'stale';

  const $from = editor.state.doc.resolve(range.from);
  const $to = editor.state.doc.resolve(range.to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return 'invalid';

  const marks = options.flattenFormatting
    ? getCommonSelectionMarks(editor, anchor)
    : getUniformSelectionMarks(editor, anchor);
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
  // scrollIntoView를 붙이지 않는다(앱 규칙 — AlignmentView.jumpToUnit 참고).
  // 이 경로는 모달에서 호출되어 뷰에 포커스가 없다. 포커스가 없으면 ProseMirror는
  // DOM selection을 갱신하지 않으므로(editorOwnsSelection) scrollIntoView는 낡은
  // DOM 노드를 기준으로 스크롤을 계산하고, 동시에 뷰의 스크롤 안정화 경로("preserve")를
  // 꺼버린다. 교체 텍스트는 길이가 달라 줄 수가 바뀌므로 안정화가 필요한 편집이다.
  // 캐럿 복귀는 아래 focus()가 담당한다.
  editor.view.dispatch(tr);
  editor.commands.focus();
  return 'applied';
}
