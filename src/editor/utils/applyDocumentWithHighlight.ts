import * as Diff from 'diff';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  addAppliedChangeMarksToTransaction,
  findSentenceRangeAt,
  type AppliedChangeRange,
} from '@/editor/extensions/AppliedChangeHighlight';
import { buildDocSearchIndex } from '@/editor/extensions/SearchHighlight';
import { createDocumentFromContent } from './replaceDocContent';

function rangesForAddedText(
  text: string,
  positions: number[],
  startOffset: number,
  length: number,
): AppliedChangeRange[] {
  const ranges: AppliedChangeRange[] = [];
  const endOffset = Math.min(text.length, startOffset + length);
  let segmentStart = startOffset;

  const appendSegment = (rawStart: number, rawEnd: number): void => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/u.test(text[start] ?? '')) start += 1;
    while (end > start && /\s/u.test(text[end - 1] ?? '')) end -= 1;
    if (start >= end) return;

    const from = positions[start];
    const lastPosition = positions[end - 1];
    if (from === undefined || lastPosition === undefined) return;
    ranges.push({ from, to: lastPosition + 1 });
  };

  for (let index = startOffset; index < endOffset; index += 1) {
    if (text[index] !== '\n') continue;
    appendSegment(segmentStart, index);
    segmentStart = index + 1;
  }
  appendSegment(segmentStart, endOffset);
  return ranges;
}

/** 원본과 적용 결과를 비교해 결과 문서에서 새로 추가·교체된 텍스트 범위를 찾는다. */
export function findAppliedChangeRanges(
  originalDoc: ProseMirrorNode,
  appliedDoc: ProseMirrorNode,
): AppliedChangeRange[] {
  const originalText = buildDocSearchIndex(originalDoc).text;
  const appliedIndex = buildDocSearchIndex(appliedDoc);
  const changes = Diff.diffWordsWithSpace(originalText, appliedIndex.text);
  const ranges: AppliedChangeRange[] = [];
  let appliedOffset = 0;

  for (const change of changes) {
    if (change.removed) continue;
    if (change.added) {
      ranges.push(...rangesForAddedText(
        appliedIndex.text,
        appliedIndex.positions,
        appliedOffset,
        change.value.length,
      ));
    }
    appliedOffset += change.value.length;
  }
  return ranges;
}

interface PreservedAppliedChangeMark {
  range: AppliedChangeRange;
  changeId: string;
}

/** 이전/새 텍스트에서 완전히 동일하게 유지된 UTF-16 offset의 대응표를 만든다. */
function buildUnchangedOffsetMap(originalText: string, appliedText: string): Map<number, number> {
  const mapping = new Map<number, number>();
  let originalOffset = 0;
  let appliedOffset = 0;

  for (const change of Diff.diffChars(originalText, appliedText)) {
    if (change.removed) {
      originalOffset += change.value.length;
    } else if (change.added) {
      appliedOffset += change.value.length;
    } else {
      for (let index = 0; index < change.value.length; index += 1) {
        mapping.set(originalOffset + index, appliedOffset + index);
      }
      originalOffset += change.value.length;
      appliedOffset += change.value.length;
    }
  }
  return mapping;
}

/**
 * 후속 폴리싱에서 문장 전체가 그대로인 경우 기존 changeId와 표시 범위를 새 문서로 옮긴다.
 * 문장 일부라도 달라지면 기존 표시는 옮기지 않고, 새 변경 범위만 새 표시가 된다.
 */
function findPreservedAppliedChangeMarks(
  originalDoc: ProseMirrorNode,
  appliedDoc: ProseMirrorNode,
): PreservedAppliedChangeMark[] {
  const originalIndex = buildDocSearchIndex(originalDoc);
  const appliedIndex = buildDocSearchIndex(appliedDoc);
  const unchangedOffsets = buildUnchangedOffsetMap(originalIndex.text, appliedIndex.text);
  const originalPositionToOffset = new Map<number, number>();
  originalIndex.positions.forEach((position, offset) => {
    originalPositionToOffset.set(position, offset);
  });

  const groups = new Map<string, {
    sentence: AppliedChangeRange;
    markedPositions: number[];
  }>();
  originalDoc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const mark = node.marks.find((candidate) => candidate.type.name === 'appliedChange');
    const changeId = mark?.attrs.changeId;
    if (typeof changeId !== 'string' || !changeId) return;
    const sentence = findSentenceRangeAt(originalDoc, position);
    if (!sentence) return;

    const group = groups.get(changeId) ?? { sentence, markedPositions: [] };
    for (let index = 0; index < node.text.length; index += 1) {
      group.markedPositions.push(position + index);
    }
    groups.set(changeId, group);
  });

  const preserved: PreservedAppliedChangeMark[] = [];
  for (const [changeId, group] of groups) {
    const sentenceOffsets: number[] = [];
    originalIndex.positions.forEach((position, offset) => {
      if (
        position >= group.sentence.from
        && position < group.sentence.to
        && originalIndex.text[offset] !== '\n'
      ) {
        sentenceOffsets.push(offset);
      }
    });
    if (sentenceOffsets.length === 0) continue;

    let previousAppliedOffset: number | null = null;
    let sentenceUnchanged = true;
    for (const originalOffset of sentenceOffsets) {
      const mapped = unchangedOffsets.get(originalOffset);
      if (
        mapped === undefined
        || (previousAppliedOffset !== null && mapped !== previousAppliedOffset + 1)
        || originalIndex.text[originalOffset] !== appliedIndex.text[mapped]
      ) {
        sentenceUnchanged = false;
        break;
      }
      previousAppliedOffset = mapped;
    }
    if (!sentenceUnchanged) continue;

    const mappedPositions = group.markedPositions
      .map((position) => originalPositionToOffset.get(position))
      .map((offset) => offset === undefined ? undefined : unchangedOffsets.get(offset))
      .map((offset) => offset === undefined ? undefined : appliedIndex.positions[offset])
      .filter((position): position is number => position !== undefined);
    if (mappedPositions.length === 0) continue;

    let rangeFrom = mappedPositions[0]!;
    let previousPosition = rangeFrom;
    for (let index = 1; index <= mappedPositions.length; index += 1) {
      const position = mappedPositions[index];
      if (position !== undefined && position === previousPosition + 1) {
        previousPosition = position;
        continue;
      }
      preserved.push({
        range: { from: rangeFrom, to: previousPosition + 1 },
        changeId,
      });
      if (position !== undefined) {
        rangeFrom = position;
        previousPosition = position;
      }
    }
  }
  return preserved;
}

export interface ReplaceDocumentWithAppliedChangesOptions {
  addToHistory?: boolean;
}

/** 문서 전체 적용과 영속 적용 마크를 하나의 undo 단위로 반영한다. */
export function replaceDocumentWithAppliedChanges(
  editor: Editor,
  content: string | Record<string, unknown>,
  options: ReplaceDocumentWithAppliedChangesOptions = {},
): AppliedChangeRange[] {
  const { state } = editor;
  const newDoc = createDocumentFromContent(editor, content);
  const ranges = findAppliedChangeRanges(state.doc, newDoc);
  const preservedMarks = findPreservedAppliedChangeMarks(state.doc, newDoc);
  const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
  tr.setMeta('selectionAnchorDocumentReplace', true);
  if (options.addToHistory === false) tr.setMeta('addToHistory', false);
  const markType = tr.doc.type.schema.marks.appliedChange;
  if (markType) {
    for (const { range, changeId } of preservedMarks) {
      tr.addMark(range.from, range.to, markType.create({ changeId }));
    }
  }
  addAppliedChangeMarksToTransaction(tr, ranges);
  editor.view.dispatch(tr);
  return ranges;
}
