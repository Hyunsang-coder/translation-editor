/**
 * 문서 블록/문장 단위 Diff·병합 유틸리티
 *
 * 폴리싱/재번역 미리보기에서 원본 Target 문서와 AI 결과 문서를 비교해
 * 선택 가능한 변경 단위(unit) 목록을 만들고, 선택된 unit만 반영한
 * 병합 문서를 생성합니다.
 *
 * 세분화 규칙:
 * - 최상위 블록을 텍스트로 정렬(diffArrays)
 * - 변경 run 안에서는 인덱스 짝이 아니라 텍스트 유사도(Dice)로 재페어링
 * - 1:1로 짝지어진 블록은 문장 단위(diffSentences)로 세분화
 * - 연속 변경·공백 정규화로 통째 hunk가 되어도 문장마다 별도 unit
 * - 리스트(bulletList/orderedList)·listItem·표(table/row/cell)는 자식 단위로 재귀 후 문장 세분화
 * - 코드/hardBreak 등 구조 블록과 블록 추가/삭제는 통째로 하나의 unit
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
    } else if (child.type === 'hardBreak') {
      // 인라인 줄바꿈이므로 버퍼에 직접 넣는다. 하위 블록 구분자(parts.join)에
      // 맡기면 텍스트 없는 연속 hardBreak가 통째로 사라져 A\n\nB가 A\nB로 줄고
      // 앞뒤에 붙은 것은 아예 없어진다(렌더링과 불일치).
      inlineBuffer += '\n';
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
 * 표시용 텍스트 정규화: 다중 공백/탭 → 단일 공백.
 *
 * 원본은 extractBlockText로 직접 직렬화되지만, 폴리싱 결과는 markdown 왕복
 * (normalizeMarkdownWhitespace/fixMisalignedBoldMarks)을 거쳐 마크 경계 공백
 * 규칙이 어긋난다. 표시 텍스트는 렌더링과 같아야 하므로 여분 공백만 정리하고
 * 실제 어절 공백은 보존한다.
 */
function normalizeDisplay(text: string): string {
  return text.replace(/[ \t]+/g, ' ');
}

/**
 * 문장 비교용 키: 마크 경계에서 생기는 인위적 공백 비대칭 제거.
 *
 * 두 경로의 공백 규칙 차이("기능 은"↔"기능은")가 diffSentences에 흘러 오탐을
 * 만든다. 비교 단계에서만 한글 음절 사이 공백을 모두 제거해 대칭을 맞춘다.
 * 어절 공백까지 함께 사라지지만, 양쪽에 동일하게 적용되므로 실제 표현 차이
 * (매우≠정말)는 그대로 남는다. 표시에는 절대 쓰지 않는다(normalizeDisplay 사용).
 *
 * 알려진 한계(의도된 트레이드오프, 코드리뷰 F6): 순수 띄어쓰기 교정
 * ("안 된다"↔"안된다", "가 나"↔"가나")도 마크 경계 공백 오탐과 구분되지 않아
 * diff에서 누락된다. 비교 시점엔 마크 정보가 이미 사라져 둘을 구별할 근거가 없고,
 * 폴리싱에서 띄어쓰기만 바뀌는 경우가 드물어 오탐 0을 우선한다. 진짜 편집이 다른
 * 글자 변경을 동반하면 정상적으로 unit이 되므로 실질 영향은 낮다.
 */
function sentenceKey(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/([가-힯]) (?=[가-힯])/g, '$1')
    .trim();
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

/** 자식 노드로 재귀 정렬하는 컨테이너 (리스트·listItem·표) */
const RECURSIVE_CONTAINER_TYPES = new Set([
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
]);
/** 문장 단위 세분화가 안전한 텍스트 블록 (partial 병합 시 plain text로 재구성됨) */
const SENTENCE_REFINABLE_TYPES = new Set(['paragraph', 'heading']);

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
    originalText: normalizeDisplay(originalText).trim(),
    polishedText: normalizeDisplay(polishedText).trim(),
  });
  return id;
}

/**
 * jsdiff `sentenceDiff.tokenize`과 동일: `.!?` + 공백에서 문장/공백 토큰 분리.
 * flush 시 통째 hunk를 문장 단위로 다시 쪼갤 때 사용한다.
 */
function tokenizeSentences(text: string): string[] {
  if (!text) return [];
  const result: string[] = [];
  let tokenStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (i === text.length - 1) {
      result.push(text.slice(tokenStart));
      break;
    }
    const ch = text[i]!;
    const next = text[i + 1]!;
    if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(next)) {
      result.push(text.slice(tokenStart, i + 1));
      let j = i + 1;
      while (j + 1 < text.length && /\s/.test(text[j + 1]!)) j++;
      result.push(text.slice(i + 1, j + 1));
      tokenStart = j + 1;
      i = j;
    }
  }
  return result;
}

function isWhitespaceToken(token: string): boolean {
  return /^\s+$/.test(token);
}

/** 문장 인덱스 뒤에 오는 공백 토큰 (없으면 null) */
function whitespaceAfterSentence(tokens: string[], sentenceIndex: number): string | null {
  let seen = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (isWhitespaceToken(token)) continue;
    if (seen === sentenceIndex) {
      const next = tokens[i + 1];
      return next && isWhitespaceToken(next) ? next : null;
    }
    seen += 1;
  }
  return null;
}

/**
 * 변경 hunk를 문장 단위 unit으로 분해해 parts에 추가.
 * 문장 사이 공백이 달라 diffSentences가 통째로 묶은 경우에도 체크박스를 문장마다 둔다.
 */
function emitSentenceChangeParts(
  state: BuildState,
  blockLabel: string,
  parts: SentencePart[],
  removed: string,
  added: string,
): void {
  const remTokens = tokenizeSentences(removed);
  const addTokens = tokenizeSentences(added);
  const remSentences = remTokens.filter((t) => !isWhitespaceToken(t));
  const addSentences = addTokens.filter((t) => !isWhitespaceToken(t));

  if (remSentences.length <= 1 && addSentences.length <= 1) {
    const unitId = addUnit(state, blockLabel, removed, added);
    parts.push({ kind: 'change', unitId, originalText: removed, polishedText: added });
    return;
  }

  const n = Math.max(remSentences.length, addSentences.length);
  for (let i = 0; i < n; i++) {
    const originalText = remSentences[i] ?? '';
    const polishedText = addSentences[i] ?? '';
    if (sentenceKey(originalText) === sentenceKey(polishedText)) {
      if (originalText) parts.push({ kind: 'equal', text: originalText });
    } else {
      const unitId = addUnit(state, blockLabel, originalText, polishedText);
      parts.push({ kind: 'change', unitId, originalText, polishedText });
    }
    if (i < n - 1) {
      const ws =
        whitespaceAfterSentence(remTokens, i) ??
        whitespaceAfterSentence(addTokens, i) ??
        ' ';
      parts.push({ kind: 'equal', text: ws });
    }
  }
}

/** 두 텍스트를 문장 단위로 비교해 equal/change 파트 생성 (문장마다 별도 unit) */
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
    // 마크 경계 공백 비대칭만 다른 변경("기능 은"↔"기능은")은 실제 변경이 아니므로
    // equal로 강등해 오탐 unit을 만들지 않는다. 원본(removed) 텍스트를 유지해
    // 병합 결과가 원본 렌더링과 일치하게 한다.
    if (sentenceKey(pendingRemoved) === sentenceKey(pendingAdded)) {
      if (pendingRemoved) parts.push({ kind: 'equal', text: pendingRemoved });
    } else {
      emitSentenceChangeParts(state, blockLabel, parts, pendingRemoved, pendingAdded);
    }
    pendingRemoved = '';
    pendingAdded = '';
    hasPending = false;
  };

  for (const change of Diff.diffSentences(originalText, polishedText)) {
    if (change.removed) {
      // 직전 remove+add 쌍이 끝났으면 새 문장 변경 전에 flush (연속 변경 병합 방지)
      if (hasPending && pendingAdded) flush();
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

  // bulletList/orderedList/listItem/table*: 자식 단위로 재귀.
  // 중첩 listItem·표 통째 swap이면 여러 문장/셀 변경이 체크 1개로 묶인다.
  if (originalType === polishedType && RECURSIVE_CONTAINER_TYPES.has(originalType)) {
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

  // 표/코드/hardBreak 등 구조 블록: 통째로 교체하는 단일 unit
  const unitId = addUnit(state, blockLabel, extractBlockText(original), extractBlockText(polished));
  return { kind: 'swap', unitId, originalBlocks: [original], polishedBlocks: [polished] };
}

/** 변경 run 안에서 블록을 내용 유사도로 짝지을 최소 Dice 점수 */
const BLOCK_PAIR_SIMILARITY_THRESHOLD = 0.45;

function tokenizeBlockKey(key: string): Set<string> {
  return new Set(
    key
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((word) => word.length > 0),
  );
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }
  return (2 * intersection) / (a.size + b.size);
}

/** 두 블록의 텍스트 유사도 (0~1). 빈 블록↔내용 블록은 0. */
function blockSimilarity(original: TipTapNodeJson, polished: TipTapNodeJson): number {
  const origKey = blockKey(extractBlockText(original));
  const polKey = blockKey(extractBlockText(polished));
  if (!origKey && !polKey) return 1;
  if (!origKey || !polKey) return 0;
  if (origKey === polKey) return 1;

  let score = diceSimilarity(tokenizeBlockKey(origKey), tokenizeBlockKey(polKey));
  // 타입이 다르면(문단↔리스트 등) 짝짓기 임계를 사실상 높이기 위해 감점
  if ((original.type ?? '') !== (polished.type ?? '')) {
    score *= 0.5;
  }
  return score;
}

/**
 * 변경 run 내부에서 원본↔폴리싱 블록을 유사도로 짝짓는다.
 * 반환: origIndex → polIndex (미매칭은 null).
 */
function matchBlocksBySimilarity(
  origRun: TipTapNodeJson[],
  polRun: TipTapNodeJson[],
): Array<number | null> {
  const matchPolForOrig: Array<number | null> = Array.from({ length: origRun.length }, () => null);
  const usedPol = new Set<number>();

  // 1) 완전 일치(정규화 키) 우선 — 빈 문단끼리도 포함
  for (let i = 0; i < origRun.length; i++) {
    const origKey = blockKey(extractBlockText(origRun[i]!));
    for (let j = 0; j < polRun.length; j++) {
      if (usedPol.has(j)) continue;
      if (blockKey(extractBlockText(polRun[j]!)) === origKey) {
        matchPolForOrig[i] = j;
        usedPol.add(j);
        break;
      }
    }
  }

  // 2) 남은 후보를 유사도 높은 순으로 탐욕 매칭
  const candidates: Array<{ i: number; j: number; sim: number }> = [];
  for (let i = 0; i < origRun.length; i++) {
    if (matchPolForOrig[i] !== null) continue;
    for (let j = 0; j < polRun.length; j++) {
      if (usedPol.has(j)) continue;
      const sim = blockSimilarity(origRun[i]!, polRun[j]!);
      if (sim >= BLOCK_PAIR_SIMILARITY_THRESHOLD) {
        candidates.push({ i, j, sim });
      }
    }
  }
  candidates.sort((a, b) => b.sim - a.sim || a.i - b.i || a.j - b.j);
  for (const c of candidates) {
    if (matchPolForOrig[c.i] !== null || usedPol.has(c.j)) continue;
    matchPolForOrig[c.i] = c.j;
    usedPol.add(c.j);
  }

  return matchPolForOrig;
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

    const matchPolForOrig = matchBlocksBySimilarity(origRun, polRun);
    const matched: Array<{ oi: number; pj: number }> = [];
    for (let oi = 0; oi < matchPolForOrig.length; oi++) {
      const pj = matchPolForOrig[oi];
      if (typeof pj === 'number') matched.push({ oi, pj });
    }
    matched.sort((a, b) => a.pj - b.pj || a.oi - b.oi);

    const unmatchedOrig = new Set(
      origRun.map((_, i) => i).filter((i) => matchPolForOrig[i] === null),
    );
    const matchedPol = new Set(matched.map((m) => m.pj));
    const unmatchedPol = new Set(
      polRun.map((_, j) => j).filter((j) => !matchedPol.has(j)),
    );

    const oiHintForInsert = (pj: number): number => {
      let hint = 0;
      for (const m of matched) {
        if (m.pj < pj) hint = m.oi + 1;
      }
      return hint;
    };

    const emitDelete = (oi: number): void => {
      const block = origRun[oi]!;
      const unitId = addUnit(state, labelFor(oStart + oi), extractBlockText(block), '');
      nodes.push({ kind: 'swap', unitId, originalBlocks: [block], polishedBlocks: [] });
    };

    const emitInsert = (pj: number): void => {
      const block = polRun[pj]!;
      const labelIndex = Math.min(oiHintForInsert(pj), Math.max(origRun.length - 1, 0));
      const unitId = addUnit(state, labelFor(oStart + labelIndex), '', extractBlockText(block));
      nodes.push({ kind: 'swap', unitId, originalBlocks: [], polishedBlocks: [block] });
    };

    let lastOi = -1;
    let lastPj = -1;
    for (const m of matched) {
      for (let oi = lastOi + 1; oi < m.oi; oi++) {
        if (unmatchedOrig.has(oi)) {
          emitDelete(oi);
          unmatchedOrig.delete(oi);
        }
      }
      for (let pj = lastPj + 1; pj < m.pj; pj++) {
        if (unmatchedPol.has(pj)) {
          emitInsert(pj);
          unmatchedPol.delete(pj);
        }
      }
      nodes.push(pairBlocks(state, labelFor(oStart + m.oi), origRun[m.oi]!, polRun[m.pj]!));
      lastOi = m.oi;
      lastPj = m.pj;
    }
    for (let oi = lastOi + 1; oi < origRun.length; oi++) {
      if (unmatchedOrig.has(oi)) emitDelete(oi);
    }
    for (let pj = lastPj + 1; pj < polRun.length; pj++) {
      if (unmatchedPol.has(pj)) emitInsert(pj);
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
