import type { Editor } from '@tiptap/core';
import { Mark } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { addAppliedChangeMarksToTransaction } from '@/editor/extensions/AppliedChangeHighlight';
import {
  getSingleAnchorRange,
  readAnchorText,
  type SelectionAnchorRecord,
  type SelectionRange,
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

function collectRangeMarkSets(editor: Editor, range: SelectionRange): Mark[][] | null {
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
 * 범위의 모든 텍스트 노드가 같은 mark 집합을 쓰는지 확인한다.
 * 서로 다른 mark를 가로지르는 교체를 시작점 mark 하나로 평탄화하면 서식과 코멘트
 * 범위가 조용히 바뀌므로, 기본 경로에서는 거부한다.
 */
function getUniformRangeMarks(
  editor: Editor,
  range: SelectionRange,
): readonly Mark[] | null {
  const markSets = collectRangeMarkSets(editor, range);
  if (!markSets) return null;
  const first = markSets[0]!;
  return markSets.every((marks) => Mark.sameSet(first, marks)) ? first : null;
}

/** 범위의 모든 텍스트 노드에 공통으로 걸린 mark만 남긴다 — 평탄화 적용 시 교체 텍스트의 서식. */
function getCommonRangeMarks(
  editor: Editor,
  range: SelectionRange,
): readonly Mark[] | null {
  const markSets = collectRangeMarkSets(editor, range);
  if (!markSets) return null;
  return markSets[0]!.filter((mark) => markSets.every((set) => mark.isInSet(set)));
}

export function getUniformSelectionMarks(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): readonly Mark[] | null {
  const range = getSingleAnchorRange(anchor);
  return range ? getUniformRangeMarks(editor, range) : null;
}

/**
 * 서식 평탄화 확인이 필요한지 판정한다. 표 다중 셀 선택은 **범위마다** 따로 본다 —
 * 굵은 셀과 평문 셀을 함께 골랐다고 서식이 섞였다고 하면, 동의 후 평탄화에서 두 셀의
 * 공통 서식(=없음)으로 굵기가 사라진다.
 */
export function selectionHasUniformFormatting(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): boolean {
  return anchor.ranges.every((range) => getUniformRangeMarks(editor, range) !== null);
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
    ? getCommonRangeMarks(editor, range)
    : getUniformRangeMarks(editor, range);
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
  // AI가 바꾼 구간에 적용 표시를 남긴다 — 검수·폴리싱·재번역 적용과 같은 성격이다.
  // 지우기(빈 문자열)는 남길 범위가 없다.
  if (replacementText) {
    addAppliedChangeMarksToTransaction(tr, [
      { from: range.from, to: range.from + replacementText.length },
    ]);
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

/**
 * 다중 범위 적용이 가능한 모양인지 — **범위마다 textblock 하나씩, 서로 다른
 * textblock**일 때 참이다 (ADR-0010의 예외).
 *
 * 이것이 정확성이 실제로 요구하는 조건이다. 범위마다 독립적으로 `replaceWith`를
 * 하므로 블록끼리 뭉개질 일이 없고, 같은 블록에 두 범위가 있으면 앞 치환이 뒤
 * 범위를 밀어 깨진다. 표 셀은 이 조건의 한 사례일 뿐이다.
 *
 * 생성 전 게이트와 적용 게이트가 같은 술어를 쓴다. 어긋나면 재번역을 다 받아 놓고
 * 적용 단계에서만 실패한다.
 */
export function canApplySelectionEdits(
  editor: Editor,
  anchor: SelectionAnchorRecord,
): boolean {
  if (editor.isDestroyed || anchor.status !== 'active' || anchor.ranges.length === 0) {
    return false;
  }
  const { doc } = editor.state;
  const blockPositions = new Set<number>();
  for (const range of anchor.ranges) {
    if (range.from < 0 || range.to <= range.from || range.to > doc.content.size) return false;
    const $from = doc.resolve(range.from);
    const $to = doc.resolve(range.to);
    if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
    blockPositions.add($from.before($from.depth));
  }
  return blockPositions.size === anchor.ranges.length;
}

export interface ApplySelectionEditsOptions {
  /** 범위마다 요청 시점의 텍스트 스냅샷 (TOCTOU 가드). 범위 수와 같아야 한다. */
  expectedTexts: string[];
  flattenFormatting?: boolean;
}

/**
 * 범위별 교체 텍스트. `null`은 **그 범위를 건드리지 않는다**(사용자가 고르지 않은 블록).
 *
 * 빈 문자열은 삭제이므로 건너뛰기를 `''`로 표현하면 그 블록이 지워진다 — 그래서 세 번째
 * 상태가 필요하다. 범위와 1:1은 유지된다(인덱스가 곧 범위).
 */
export type SelectionEditReplacement = string | null;

/**
 * 여러 블록(표 셀 / 문단)을 **한 트랜잭션**으로 교체한다 (Undo 한 단계).
 *
 * `applySelectionEdit`이 다중 범위를 거부하는 이유는 평문 하나로 여러 블록을 덮으면
 * 문단·셀이 한 덩어리로 뭉개지기 때문이다. 여기서는 범위마다 **독립적인** replaceWith를
 * 쓰므로 그 문제가 없다. 모양 검증은 `canApplySelectionEdits`가 한다.
 *
 * `getSingleAnchorRange` 우회는 이 함수 안에서만 유효하다 — 다른 호출부가 `ranges[0]`을
 * 쓰기 시작하면 첫 블록만 덮어쓰는 버그가 된다.
 *
 * `null`인 범위는 건너뛴다(부분 적용). 검증(stale·서식)도 실제로 교체하는 범위만 본다 —
 * 고르지 않은 블록의 서식이 섞였다고 고른 블록의 적용까지 막을 이유가 없다.
 */
export function applySelectionEdits(
  editor: Editor,
  anchor: SelectionAnchorRecord,
  replacements: readonly SelectionEditReplacement[],
  options: ApplySelectionEditsOptions,
): ApplySelectionEditResult {
  if (
    anchor.ranges.length !== replacements.length ||
    anchor.ranges.length !== options.expectedTexts.length ||
    !canApplySelectionEdits(editor, anchor)
  ) {
    return anchor.status === 'stale' ? 'stale' : 'invalid';
  }

  const { doc } = editor.state;
  const ranges = anchor.ranges;
  for (const [index, range] of ranges.entries()) {
    if (replacements[index] === null) continue;
    if (readAnchorText(doc, range.from, range.to) !== options.expectedTexts[index]) {
      return 'stale';
    }
  }

  const marksByRange = ranges.map((range, index) =>
    replacements[index] === null
      ? null
      : options.flattenFormatting
        ? getCommonRangeMarks(editor, range)
        : getUniformRangeMarks(editor, range),
  );
  if (marksByRange.some((marks, index) => replacements[index] !== null && marks === null)) {
    return 'formatting-conflict';
  }

  const tr = editor.state.tr;
  // 문서 **뒤쪽 범위부터** 치환한다 — 앞을 먼저 바꾸면 길이 차이만큼 뒤 범위의 위치가
  // 밀려 엉뚱한 셀을 덮는다.
  const orderedIndexes = ranges
    .map((_range, index) => index)
    .sort((a, b) => ranges[b]!.from - ranges[a]!.from);
  for (const index of orderedIndexes) {
    const range = ranges[index]!;
    const replacement = replacements[index]!;
    if (replacement === null) continue;
    if (replacement) {
      tr.replaceWith(
        range.from,
        range.to,
        editor.schema.text(replacement, [...marksByRange[index]!]),
      );
      // 마크는 루프 안에서 붙인다. 여기서 range.from은 아직 유효하고, 이후 더 앞쪽
      // 범위를 치환하면 마크는 문서에 실려 함께 밀린다. 루프 뒤에 몰아 붙이면
      // 앞쪽 치환으로 밀린 좌표를 그대로 써 엉뚱한 곳이 칠해진다.
      addAppliedChangeMarksToTransaction(tr, [
        { from: range.from, to: range.from + replacement.length },
      ]);
    } else {
      tr.delete(range.from, range.to);
    }
  }
  tr.setMeta(pluginKeys.selectionAnchor, {
    type: 'remove',
    anchorId: anchor.anchorId,
  });
  // 단일 범위와 달리 캐럿을 어디에 둘지가 정해지지 않는다 — 선택은 트랜잭션 매핑에
  // 맡기고 포커스만 되돌린다. scrollIntoView를 붙이지 않는 이유는 위와 같다.
  editor.view.dispatch(tr);
  editor.commands.focus();
  return 'applied';
}
