/**
 * 문서 블록/문장 단위 Diff·병합 유틸리티
 *
 * 폴리싱/재번역 미리보기에서 원본 Target 문서와 AI 결과 문서를 비교해
 * 선택 가능한 변경 단위(unit) 목록을 만들고, 선택된 unit만 반영한
 * 병합 문서를 생성합니다.
 *
 * 세분화 규칙:
 * - 최상위 블록을 텍스트로 정렬(diffArrays)
 * - 1:1로 짝지어진 블록은 문장 단위(diffSentences)로 세분화
 * - 리스트(bulletList/orderedList)는 항목(listItem) 단위로 재귀 정렬 후 문장 세분화
 * - 표/코드 등 구조 블록과 블록 추가/삭제는 통째로 하나의 unit
 */

import * as Diff from 'diff';
import type { TipTapDocJson } from '@/utils/markdownConverter';

interface TipTapNodeJson {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNodeJson[];
}

/** UI에 노출되는 선택 가능한 변경 단위 */
export interface DocChangeUnit {
  id: string;
  /** 표시용 문단 라벨 (원본 최상위 블록 기준 1-based) */
  blockLabel: string;
  /** 표시용 기존 텍스트 (빈 문자열 = 추가) */
  originalText: string;
  /** 표시용 제안 텍스트 (빈 문자열 = 삭제) */
  polishedText: string;
}

type SentencePart =
  | { kind: 'equal'; text: string }
  | { kind: 'change'; unitId: string; originalText: string; polishedText: string };

type PlanNode =
  | { kind: 'keep'; blocks: TipTapNodeJson[] }
  | { kind: 'swap'; unitId: string; originalBlocks: TipTapNodeJson[]; polishedBlocks: TipTapNodeJson[] }
  | { kind: 'pair'; original: TipTapNodeJson; polished: TipTapNodeJson; parts: SentencePart[] }
  | { kind: 'listPair'; original: TipTapNodeJson; polished: TipTapNodeJson; itemNodes: PlanNode[] };

export interface DocDiffPlan {
  units: DocChangeUnit[];
  /** @internal mergeDocBySelection에서 사용하는 병합 계획 */
  nodes: PlanNode[];
}

/** 블록 노드의 텍스트를 재귀적으로 추출 (하위 블록은 \n으로 구분) */
export function extractBlockText(node: TipTapNodeJson): string {
  if (node.text) return node.text;
  if (!node.content || node.content.length === 0) return '';

  const parts: string[] = [];
  let inlineBuffer = '';
  for (const child of node.content) {
    if (child.text !== undefined || child.type === 'text') {
      inlineBuffer += child.text ?? '';
    } else {
      const childText = extractBlockText(child);
      if (inlineBuffer) {
        parts.push(inlineBuffer);
        inlineBuffer = '';
      }
      if (childText) parts.push(childText);
    }
  }
  if (inlineBuffer) parts.push(inlineBuffer);
  return parts.join('\n');
}

/**
 * 비교용 키: 공백 정규화만 수행 (표현 차이는 실제 변경으로 취급).
 * 주의: extractBlockText는 marks/attrs를 무시하므로, 텍스트가 같고 마크/attrs만
 * 다른 블록은 'keep'으로 분류되어 unit이 되지 않는다(부분 선택 시 원본이 유지됨).
 */
function blockKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 문장 단위 부분 병합이 안전한 평탄 블록 판정: 인라인 text 노드만 포함.
 * (listItem은 단일 paragraph 하나만 담는 경우에 한해 평탄으로 본다.)
 *
 * 평탄하지 않은 블록(중첩 리스트/다중 문단/hardBreak/인라인 이미지 등)을 문장
 * 세분화하면 rebuildLeaf가 구조를 파괴하므로, 이런 블록은 통째 swap으로 강등한다.
 */
function isFlatTextBlock(node: TipTapNodeJson): boolean {
  if (node.type === 'listItem') {
    const content = node.content ?? [];
    return content.length === 1 && content[0]!.type === 'paragraph' && isFlatTextBlock(content[0]!);
  }
  return (node.content ?? []).every(
    (child) => child.type === 'text' || child.text !== undefined,
  );
}

function getBlocks(doc: TipTapDocJson): TipTapNodeJson[] {
  const content = doc.content;
  return Array.isArray(content) ? (content as TipTapNodeJson[]) : [];
}

const LIST_TYPES = new Set(['bulletList', 'orderedList']);
/** 문장 단위 세분화가 안전한 텍스트 블록 (partial 병합 시 plain text로 재구성됨) */
const SENTENCE_REFINABLE_TYPES = new Set(['paragraph', 'heading', 'listItem']);

interface BuildState {
  unitSeq: number;
  units: DocChangeUnit[];
}

function addUnit(
  state: BuildState,
  blockLabel: string,
  originalText: string,
  polishedText: string,
): string {
  const id = `unit-${state.unitSeq++}`;
  state.units.push({
    id,
    blockLabel,
    originalText: originalText.trim(),
    polishedText: polishedText.trim(),
  });
  return id;
}

/** 두 텍스트를 문장 단위로 비교해 equal/change 파트 생성 (연속 변경 문장은 하나의 unit) */
function buildSentenceParts(
  state: BuildState,
  blockLabel: string,
  originalText: string,
  polishedText: string,
): SentencePart[] {
  const parts: SentencePart[] = [];
  let pendingRemoved = '';
  let pendingAdded = '';
  let hasPending = false;

  const flush = (): void => {
    if (!hasPending) return;
    const unitId = addUnit(state, blockLabel, pendingRemoved, pendingAdded);
    parts.push({ kind: 'change', unitId, originalText: pendingRemoved, polishedText: pendingAdded });
    pendingRemoved = '';
    pendingAdded = '';
    hasPending = false;
  };

  for (const change of Diff.diffSentences(originalText, polishedText)) {
    if (change.removed) {
      pendingRemoved += change.value;
      hasPending = true;
    } else if (change.added) {
      pendingAdded += change.value;
      hasPending = true;
    } else {
      flush();
      parts.push({ kind: 'equal', text: change.value });
    }
  }
  flush();

  return parts;
}

/** 1:1로 짝지어진 블록 쌍의 계획 노드 생성 */
function pairBlocks(
  state: BuildState,
  blockLabel: string,
  original: TipTapNodeJson,
  polished: TipTapNodeJson,
): PlanNode {
  const originalType = original.type ?? '';
  const polishedType = polished.type ?? '';

  if (originalType === polishedType && LIST_TYPES.has(originalType)) {
    const itemNodes = buildNodes(state, original.content ?? [], polished.content ?? [], () => blockLabel);
    return { kind: 'listPair', original, polished, itemNodes };
  }

  if (
    SENTENCE_REFINABLE_TYPES.has(originalType) &&
    SENTENCE_REFINABLE_TYPES.has(polishedType) &&
    isFlatTextBlock(original) &&
    isFlatTextBlock(polished)
  ) {
    const parts = buildSentenceParts(state, blockLabel, extractBlockText(original), extractBlockText(polished));
    return { kind: 'pair', original, polished, parts };
  }

  // 표/코드 등 구조 블록: 통째로 교체하는 단일 unit
  const unitId = addUnit(state, blockLabel, extractBlockText(original), extractBlockText(polished));
  return { kind: 'swap', unitId, originalBlocks: [original], polishedBlocks: [polished] };
}

/** 블록 배열을 정렬해 계획 노드 목록 생성 (리스트 항목 재귀에도 사용) */
function buildNodes(
  state: BuildState,
  originalBlocks: TipTapNodeJson[],
  polishedBlocks: TipTapNodeJson[],
  labelFor: (originalIndex: number) => string,
): PlanNode[] {
  const diff = Diff.diffArrays(
    originalBlocks.map((b) => blockKey(extractBlockText(b))),
    polishedBlocks.map((b) => blockKey(extractBlockText(b))),
  );

  const nodes: PlanNode[] = [];
  let origIndex = 0;
  let polIndex = 0;
  let pendingOrigStart: number | null = null;
  let pendingPolStart: number | null = null;

  const flushChanged = (): void => {
    if (pendingOrigStart === null && pendingPolStart === null) return;
    const oStart = pendingOrigStart ?? origIndex;
    const pStart = pendingPolStart ?? polIndex;
    const origRun = originalBlocks.slice(oStart, origIndex);
    const polRun = polishedBlocks.slice(pStart, polIndex);

    // 같은 위치의 블록끼리 짝지어 세분화, 남는 블록은 통째 추가/삭제 unit
    const paired = Math.min(origRun.length, polRun.length);
    for (let i = 0; i < paired; i++) {
      nodes.push(pairBlocks(state, labelFor(oStart + i), origRun[i]!, polRun[i]!));
    }
    if (origRun.length > paired) {
      const leftovers = origRun.slice(paired);
      const unitId = addUnit(
        state,
        labelFor(oStart + paired),
        leftovers.map(extractBlockText).join('\n'),
        '',
      );
      nodes.push({ kind: 'swap', unitId, originalBlocks: leftovers, polishedBlocks: [] });
    } else if (polRun.length > paired) {
      const leftovers = polRun.slice(paired);
      const unitId = addUnit(
        state,
        labelFor(oStart + paired),
        '',
        leftovers.map(extractBlockText).join('\n'),
      );
      nodes.push({ kind: 'swap', unitId, originalBlocks: [], polishedBlocks: leftovers });
    }

    pendingOrigStart = null;
    pendingPolStart = null;
  };

  for (const part of diff) {
    const count = part.value.length;
    if (part.removed) {
      if (pendingOrigStart === null) pendingOrigStart = origIndex;
      if (pendingPolStart === null) pendingPolStart = polIndex;
      origIndex += count;
    } else if (part.added) {
      if (pendingOrigStart === null) pendingOrigStart = origIndex;
      if (pendingPolStart === null) pendingPolStart = polIndex;
      polIndex += count;
    } else {
      flushChanged();
      nodes.push({ kind: 'keep', blocks: originalBlocks.slice(origIndex, origIndex + count) });
      origIndex += count;
      polIndex += count;
    }
  }
  flushChanged();

  return nodes;
}

/** 원본/폴리싱 문서를 비교해 선택 가능한 변경 unit 목록과 병합 계획 생성 */
export function buildDocDiffPlan(
  originalDoc: TipTapDocJson,
  polishedDoc: TipTapDocJson,
): DocDiffPlan {
  const state: BuildState = { unitSeq: 0, units: [] };
  const nodes = buildNodes(state, getBlocks(originalDoc), getBlocks(polishedDoc), (i) => `¶${i + 1}`);
  return { units: state.units, nodes };
}

/**
 * 부분 병합된 텍스트로 leaf 블록 재구성 (원본 type/attrs 유지).
 * 한계: 평탄 블록(isFlatTextBlock)만 도달하며, 부분 병합 시 블록 전체의 인라인
 * marks가 유실된다(선택하지 않은 equal 문장 포함). equal 파트를 plain text로
 * 재조립하는 설계상 한계로, 이 함수는 중첩 구조를 만들지 않는다.
 */
function rebuildLeaf(original: TipTapNodeJson, text: string): TipTapNodeJson {
  const content = text ? [{ type: 'text', text }] : [];
  if (original.type === 'listItem') {
    return { ...original, content: [{ type: 'paragraph', content }] };
  }
  return { ...original, content };
}

function mergeNodes(nodes: PlanNode[], selectedIds: ReadonlySet<string>): TipTapNodeJson[] {
  const out: TipTapNodeJson[] = [];

  for (const node of nodes) {
    switch (node.kind) {
      case 'keep':
        out.push(...node.blocks);
        break;
      case 'swap':
        out.push(...(selectedIds.has(node.unitId) ? node.polishedBlocks : node.originalBlocks));
        break;
      case 'pair': {
        const changes = node.parts.filter((p): p is Extract<SentencePart, { kind: 'change' }> => p.kind === 'change');
        const selectedCount = changes.filter((p) => selectedIds.has(p.unitId)).length;
        if (selectedCount === 0) {
          out.push(node.original);
        } else if (selectedCount === changes.length) {
          out.push(node.polished);
        } else {
          const text = node.parts
            .map((p) =>
              p.kind === 'equal'
                ? p.text
                : selectedIds.has(p.unitId)
                  ? p.polishedText
                  : p.originalText,
            )
            .join('')
            .trim();
          out.push(rebuildLeaf(node.original, text));
        }
        break;
      }
      case 'listPair': {
        const items = mergeNodes(node.itemNodes, selectedIds);
        const originalItems = node.original.content ?? [];
        const unchanged =
          items.length === originalItems.length && items.every((item, i) => item === originalItems[i]);
        out.push(unchanged ? node.original : { ...node.original, content: items });
        break;
      }
    }
  }

  return out;
}

/** 선택된 unit만 반영한 병합 문서 생성 (미선택/동일 블록은 원본 노드 유지) */
export function mergeDocBySelection(
  originalDoc: TipTapDocJson,
  plan: DocDiffPlan,
  selectedIds: ReadonlySet<string>,
): TipTapDocJson {
  return { ...originalDoc, type: 'doc', content: mergeNodes(plan.nodes, selectedIds) };
}
