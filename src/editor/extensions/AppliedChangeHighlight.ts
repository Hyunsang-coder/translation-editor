import { Mark, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

export interface AppliedChangeRange {
  from: number;
  to: number;
}

const APPLIED_CHANGE_APPLY_META = 'appliedChangeApply';
/** 마크-only 확인 트랜잭션 표식. ReviewPanel의 리뷰 undo 감시가 스킵한다. 값 변경 금지. */
export const APPLIED_CHANGE_CLEAR_META = 'appliedChangeClear';
const DOCUMENT_REPLACE_META = 'selectionAnchorDocumentReplace';
const SENTENCE_TERMINATORS = new Set(['.', '!', '?', '。', '！', '？']);
let nextChangeId = 0;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    appliedChangeHighlight: {
      /** 문서 전체의 AI 적용 표시를 해제한다. 본문 텍스트는 유지한다. */
      clearAppliedChangeHighlights: () => ReturnType;
      /** 해당 changeId(문장 그룹)의 적용 표시만 해제한다. 본문 텍스트는 유지한다. */
      clearAppliedChangeById: (changeId: string) => ReturnType;
    };
  }
}

function createChangeId(): string {
  nextChangeId += 1;
  return `applied-${Date.now().toString(36)}-${nextChangeId.toString(36)}`;
}

function normalizeRanges(
  ranges: AppliedChangeRange[],
  docSize: number,
): AppliedChangeRange[] {
  return ranges
    .map(({ from, to }) => ({
      from: Math.max(0, Math.min(docSize, from)),
      to: Math.max(0, Math.min(docSize, to)),
    }))
    .filter(({ from, to }) => from < to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** 주어진 위치가 속한 textblock 안에서 문장 범위를 찾는다. */
export function findSentenceRangeAt(
  doc: ProseMirrorNode,
  position: number,
): AppliedChangeRange | null {
  const safePosition = Math.max(0, Math.min(doc.content.size, position));
  const resolved = doc.resolve(safePosition);
  let textblockDepth: number | null = null;
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    if (resolved.node(depth).isTextblock) {
      textblockDepth = depth;
      break;
    }
  }
  if (textblockDepth === null) return null;

  const blockFrom = resolved.start(textblockDepth);
  const blockTo = resolved.end(textblockDepth);
  const text = doc.textBetween(blockFrom, blockTo, '\n', '\ufffc');
  const localPosition = Math.max(0, Math.min(text.length, safePosition - blockFrom));

  let localFrom = 0;
  for (let index = 0; index < localPosition; index += 1) {
    if (SENTENCE_TERMINATORS.has(text[index] ?? '')) localFrom = index + 1;
  }
  while (localFrom < text.length && /\s/u.test(text[localFrom] ?? '')) localFrom += 1;

  let localTo = text.length;
  for (let index = localPosition; index < text.length; index += 1) {
    if (SENTENCE_TERMINATORS.has(text[index] ?? '')) {
      localTo = index + 1;
      break;
    }
  }

  return { from: blockFrom + localFrom, to: blockFrom + localTo };
}

/**
 * 이미 문서를 변경 중인 transaction에 적용 표시 마크를 추가한다.
 * 같은 문장 안의 여러 변경 범위에는 같은 changeId를 부여해, 문장 일부 편집 시
 * 해당 문장의 표시를 한 번에 제거할 수 있게 한다.
 */
export function addAppliedChangeMarksToTransaction(
  transaction: Transaction,
  ranges: AppliedChangeRange[],
): Transaction {
  const markType = transaction.doc.type.schema.marks.appliedChange;
  if (!markType) return transaction;

  const groups = new Map<string, {
    id: string;
    sentence: AppliedChangeRange;
    ranges: AppliedChangeRange[];
  }>();
  for (const range of normalizeRanges(ranges, transaction.doc.content.size)) {
    const sentence = findSentenceRangeAt(transaction.doc, range.from);
    const key = sentence ? `${sentence.from}:${sentence.to}` : `${range.from}:${range.to}`;
    const group = groups.get(key) ?? {
      id: createChangeId(),
      sentence: sentence ?? range,
      ranges: [],
    };
    group.ranges.push(range);
    groups.set(key, group);
  }

  // 같은 문장에 이전 AI 적용 표시가 남아 있다면 새 변경 표시로 교체한다.
  for (const group of groups.values()) {
    transaction.removeMark(group.sentence.from, group.sentence.to, markType);
  }
  for (const group of groups.values()) {
    const mark = markType.create({ changeId: group.id });
    for (const range of group.ranges) {
      transaction.addMark(range.from, range.to, mark);
    }
  }
  if (groups.size > 0) transaction.setMeta(APPLIED_CHANGE_APPLY_META, true);
  return transaction;
}

/** 별도 문서 변경 없이 현재 문서 범위에 적용 표시를 추가한다. */
export function markAppliedChanges(editor: Editor, ranges: AppliedChangeRange[]): void {
  if (editor.isDestroyed) return;
  const transaction = addAppliedChangeMarksToTransaction(editor.state.tr, ranges);
  if (!transaction.getMeta(APPLIED_CHANGE_APPLY_META)) return;
  editor.view.dispatch(transaction);
}

export function hasAppliedChangeHighlights(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === 'appliedChange')) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

export interface AppliedChangeGroup {
  id: string;
  from: number;
  to: number;
}

/**
 * 문서 순서대로 정렬된 적용 표시 그룹 목록. 같은 changeId(문장 그룹)는
 * 최소~최대 위치로 병합한다(findCommentRange와 같은 규칙).
 * 렌더 경로에서 호출하지 말 것 — 탐색 버튼 클릭 시에만 계산한다.
 */
export function getAppliedChangeGroups(doc: ProseMirrorNode): AppliedChangeGroup[] {
  const groups = new Map<string, { from: number; to: number }>();
  doc.descendants((node, position) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'appliedChange') continue;
      const changeId = mark.attrs.changeId;
      if (typeof changeId !== 'string' || !changeId) continue;
      const end = position + node.nodeSize;
      const group = groups.get(changeId);
      if (group) {
        if (position < group.from) group.from = position;
        if (end > group.to) group.to = end;
      } else {
        groups.set(changeId, { from: position, to: end });
      }
    }
  });
  return Array.from(groups, ([id, range]) => ({ id, ...range }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** 서로 다른 changeId 개수. 렌더 구독용 primitive — has 체크는 `count > 0`으로 유도한다. */
export function countAppliedChangeGroups(doc: ProseMirrorNode): number {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'appliedChange') continue;
      const changeId = mark.attrs.changeId;
      if (typeof changeId === 'string' && changeId) ids.add(changeId);
    }
  });
  return ids.size;
}

/**
 * selection이 걸린 적용 표시의 changeId. 범위 선택이면 첫 적중,
 * 빈 선택(캐럿)이면 앞뒤 텍스트 노드에서 찾는다. 없으면 null.
 * 반환이 primitive라 useEditorState selector에 안전하다.
 */
export function getAppliedChangeIdAtSelection(state: EditorState): string | null {
  const { selection, doc } = state;
  const readMarks = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]): string | null => {
    for (const mark of marks) {
      if (mark.type.name !== 'appliedChange') continue;
      const changeId = mark.attrs.changeId;
      if (typeof changeId === 'string' && changeId) return changeId;
    }
    return null;
  };
  if (!selection.empty) {
    let found: string | null = null;
    doc.nodesBetween(selection.from, selection.to, (node) => {
      if (found !== null || !node.isText) return;
      found = readMarks(node.marks);
    });
    return found;
  }
  const $pos = doc.resolve(selection.from);
  const after = $pos.nodeAfter;
  if (after?.isText) {
    const found = readMarks(after.marks);
    if (found !== null) return found;
  }
  const before = $pos.nodeBefore;
  if (before?.isText) {
    const found = readMarks(before.marks);
    if (found !== null) return found;
  }
  return null;
}

function collectTouchedChangeIds(
  doc: ProseMirrorNode,
  changeFrom: number,
  changeTo: number,
  ids: Set<string>,
): void {
  const collectIdsInRange = ({ from, to }: AppliedChangeRange): void => {
    if (from >= to) return;
    doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type.name !== 'appliedChange') continue;
        const changeId = mark.attrs.changeId;
        if (typeof changeId === 'string' && changeId) ids.add(changeId);
      }
    });
  };

  const startSentence = findSentenceRangeAt(doc, changeFrom);
  if (startSentence) collectIdsInRange(startSentence);

  if (changeTo > changeFrom) {
    const endSentence = findSentenceRangeAt(doc, Math.max(changeFrom, changeTo - 1));
    if (
      endSentence
      && (!startSentence
        || endSentence.from !== startSentence.from
        || endSentence.to !== startSentence.to)
    ) {
      collectIdsInRange(endSentence);
    }

    // 여러 문장/블록을 한 번에 지우는 경우, 시작·끝 문장 사이에서 직접
    // 삭제되는 적용 마크도 수집한다.
    const safeFrom = Math.max(0, Math.min(doc.content.size, changeFrom));
    const safeTo = Math.max(safeFrom, Math.min(doc.content.size, changeTo));
    collectIdsInRange({ from: safeFrom, to: safeTo });
  }
}

function removeAppliedChangeIds(
  doc: ProseMirrorNode,
  transaction: Transaction,
  ids: ReadonlySet<string>,
): void {
  doc.descendants((node, position) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (
        mark.type.name === 'appliedChange'
        && typeof mark.attrs.changeId === 'string'
        && ids.has(mark.attrs.changeId)
      ) {
        transaction.removeMark(position, position + node.nodeSize, mark);
      }
    }
  });
}

/**
 * 저장 가능한 적용 표시 마크.
 * - JSON/HTML에 영속된다.
 * - 같은 문장을 사용자가 수정하면 그 문장의 changeId 마크만 자동 제거한다.
 * - 프로젝트 로드/문서 전체 교체와 AI 적용 transaction은 자동 제거 대상이 아니다.
 */
export const AppliedChangeHighlight = Mark.create({
  name: 'appliedChange',
  inclusive: false,

  addAttributes() {
    return {
      changeId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-applied-change-id'),
        renderHTML: (attributes) => {
          if (typeof attributes.changeId !== 'string' || !attributes.changeId) return {};
          return { 'data-applied-change-id': attributes.changeId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-applied-change]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-applied-change': '',
        class: 'applied-change-highlight',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      clearAppliedChangeHighlights:
        () =>
        ({ state, dispatch }) => {
          const markType = state.schema.marks.appliedChange;
          if (!markType || !hasAppliedChangeHighlights(state.doc)) return false;
          if (dispatch) {
            dispatch(
              state.tr
                .removeMark(0, state.doc.content.size, markType)
                .setMeta(APPLIED_CHANGE_CLEAR_META, true),
            );
          }
          return true;
        },
      clearAppliedChangeById:
        (changeId: string) =>
        ({ state, dispatch }) => {
          const markType = state.schema.marks.appliedChange;
          if (!markType || !changeId) return false;
          let found = false;
          state.doc.descendants((node) => {
            if (found || !node.isText) return;
            for (const mark of node.marks) {
              if (mark.type.name === 'appliedChange' && mark.attrs.changeId === changeId) {
                found = true;
                break;
              }
            }
          });
          if (!found) return false;
          if (dispatch) {
            const tr = state.tr;
            removeAppliedChangeIds(state.doc, tr, new Set([changeId]));
            dispatch(tr.setMeta(APPLIED_CHANGE_CLEAR_META, true));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          const touchedIds = new Set<string>();

          for (const transaction of transactions) {
            if (!transaction.docChanged) continue;
            if (
              transaction.getMeta(APPLIED_CHANGE_APPLY_META)
              || transaction.getMeta(APPLIED_CHANGE_CLEAR_META)
              || transaction.getMeta(DOCUMENT_REPLACE_META)
            ) {
              continue;
            }

            transaction.mapping.maps.forEach((stepMap, index) => {
              const docBeforeStep = transaction.docs[index] ?? transaction.before;
              stepMap.forEach((oldStart, oldEnd) => {
                collectTouchedChangeIds(docBeforeStep, oldStart, oldEnd, touchedIds);
              });
            });
          }

          if (touchedIds.size === 0) return null;
          const tr = newState.tr;
          removeAppliedChangeIds(newState.doc, tr, touchedIds);
          if (tr.steps.length === 0) return null;
          return tr
            .setMeta(APPLIED_CHANGE_CLEAR_META, true)
            .setMeta('addToHistory', false);
        },
      }),
    ];
  },
});
