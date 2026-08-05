import type { SearchMatch } from '@/editor/extensions/SearchHighlight';
import {
  filterMatchesInRange,
  findSegmentRange,
  buildDocSearchIndex,
  rangeCrossesBlockBoundary,
} from '@/editor/extensions/SearchHighlight';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import type { Editor } from '@tiptap/react';
import {
  normalizeForSearch,
  buildNormalizedTextWithMapping,
  stripRichTextMarkup,
  stripWrappingQuotes,
  getWrappingQuotePair,
} from '@/utils/normalizeForSearch';
import type { ReviewIssue } from '@/stores/reviewStore';

/** reviewStore가 새 적용 transaction을 redo로 오인하지 않도록 구분하는 meta. */
export const REVIEW_SUGGESTION_APPLY_META = 'reviewSuggestionApply';

export function normalizeSegmentGroupId(segmentGroupId: string | undefined): string | undefined {
  if (!segmentGroupId) return undefined;
  return segmentGroupId.startsWith('#') ? segmentGroupId.slice(1) : segmentGroupId;
}

export function hasSegmentGroupId(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.attrs?.segmentGroupId) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

export function filterMatchesBySegment(
  matches: SearchMatch[],
  segmentRange: { from: number; to: number } | null,
  requireSegmentRange: boolean,
  hasSegmentGroups: boolean,
): SearchMatch[] {
  if (!requireSegmentRange) return matches;
  if (!segmentRange) return hasSegmentGroups && matches.length > 1 ? [] : matches;
  return filterMatchesInRange(matches, segmentRange);
}

/**
 * excerpt 검색용 사전 계산 컨텍스트.
 * 여러 이슈를 같은 문서에서 연속 검색할 때(예: 하이라이트 decoration)
 * 텍스트/매핑 재계산을 피하기 위해 사용합니다.
 */
export interface ExcerptSearchContext {
  positions: number[];
  normalizedFullText: string;
  fullTextIndexMap: number[];
  hasSegmentGroups: boolean;
  /**
   * segmentGroupId → 세그먼트 범위 맵 (문서 1회 순회로 구축).
   * 이슈마다 findSegmentRange로 문서 전체를 재스캔(O(k·n))하지 않기 위한 캐시로,
   * 각 항목은 findSegmentRange(doc, id)와 동일한 결과를 갖는다.
   */
  segmentRanges: Map<string, { from: number; to: number }>;
}

export function buildExcerptSearchContext(doc: ProseMirrorNode): ExcerptSearchContext {
  // 텍스트/위치/세그먼트 범위를 한 번의 순회로 구축 (P2 최적화)
  const { text, positions, segmentRanges } = buildDocSearchIndex(doc);
  const { normalizedText, indexMap } = buildNormalizedTextWithMapping(text);
  return {
    positions,
    normalizedFullText: normalizedText,
    fullTextIndexMap: indexMap,
    hasSegmentGroups: segmentRanges.size > 0,
    segmentRanges,
  };
}

/**
 * AI excerpt를 정규화해 문서에서 위치를 찾는다.
 * - 노드 경계를 넘는 텍스트도 검색 가능 (buildTextWithPositions)
 * - 양방향 정규화: 에디터 텍스트와 검색 텍스트 모두 정규화하여 비교
 * - segmentGroupId가 있으면 해당 세그먼트 범위 내 첫 매치만 반환
 *
 * @returns { from, to } (to는 exclusive), 못 찾으면 null
 */
export function findExcerptRange(
  doc: ProseMirrorNode,
  rawExcerpt: string | undefined,
  segmentGroupId: string | undefined,
  ctx?: ExcerptSearchContext,
): { from: number; to: number } | null {
  if (!rawExcerpt || rawExcerpt.length === 0) return null;

  const context = ctx ?? buildExcerptSearchContext(doc);

  const normalizedSegmentGroupId = normalizeSegmentGroupId(segmentGroupId);
  // 컨텍스트에 사전 계산된 세그먼트 범위 사용 (findSegmentRange와 동일 결과, 전체 스캔 제거)
  const segmentRange = normalizedSegmentGroupId
    ? context.segmentRanges.get(normalizedSegmentGroupId) ?? null
    : null;
  if (segmentGroupId && context.hasSegmentGroups && !segmentRange) {
    return null;
  }

  // 1차: excerpt 그대로 / 2차: 감싸는 따옴표 제거 후 재시도 (AI가 "..."로 감싸는 경우)
  const candidates = [normalizeForSearch(rawExcerpt)];
  const stripped = normalizeForSearch(stripWrappingQuotes(rawExcerpt));
  if (stripped.length > 0 && stripped !== candidates[0]) {
    candidates.push(stripped);
  }

  for (const searchText of candidates) {
    if (searchText.length === 0) continue;
    const ranges = findNormalizedTextRanges(searchText, segmentRange, context, 2);
    if (ranges.length === 1) return ranges[0]!;
    if (ranges.length > 1) {
      // 세그먼트로 좁혀지지 않은 다중 매치는 위치가 모호 → 교체 포기
      // (구 filterMatchesBySegment의 다중 매치 가드 시맨틱 복원, 비세그먼트 문서 포함)
      if (!segmentRange) return null;
      // 세그먼트 내 다중 매치는 기존대로 첫 매치 (범위가 이미 좁음)
      return ranges[0]!;
    }
  }
  return null;
}

/**
 * 정규화된 검색 텍스트의 유효 매치를 최대 limit개 수집.
 * 다중 매치 모호성 판정을 위해 첫 매치에서 멈추지 않고 limit까지 수집한다.
 */
function findNormalizedTextRanges(
  searchText: string,
  segmentRange: { from: number; to: number } | null,
  ctx: ExcerptSearchContext,
  limit: number,
): Array<{ from: number; to: number }> {
  const { positions, normalizedFullText, fullTextIndexMap } = ctx;
  const results: Array<{ from: number; to: number }> = [];

  let normalizedIndex = -1;
  let searchFrom = 0;

  while ((normalizedIndex = normalizedFullText.indexOf(searchText, searchFrom)) !== -1) {
    if (normalizedIndex >= fullTextIndexMap.length) {
      break;
    }

    // 정규화된 인덱스 → 원본 텍스트 인덱스 → 문서 위치
    const originalStartIndex = fullTextIndexMap[normalizedIndex];
    if (originalStartIndex === undefined) {
      searchFrom = normalizedIndex + 1;
      continue;
    }

    const normalizedEndIndex = normalizedIndex + searchText.length - 1;
    const originalEndIndex =
      normalizedEndIndex < fullTextIndexMap.length
        ? fullTextIndexMap[normalizedEndIndex]
        : undefined;

    if (originalEndIndex === undefined) {
      searchFrom = normalizedIndex + 1;
      continue;
    }

    const from = positions[originalStartIndex];
    const to = positions[originalEndIndex];

    if (from === undefined || to === undefined) {
      searchFrom = normalizedIndex + 1;
      continue;
    }

    const toExclusive = to + 1;
    const inSegmentRange =
      !segmentRange || (from >= segmentRange.from && toExclusive <= segmentRange.to);

    if (toExclusive > from && inSegmentRange) {
      results.push({ from, to: toExclusive });
      if (results.length >= limit) break;
    }

    searchFrom = normalizedIndex + 1;
  }

  return results;
}

/**
 * suggestedFix에서 HTML/인라인 마크다운을 제거해 에디터에 넣을 기본 plain text 생성.
 * 감싸는 따옴표는 여기서 제거하지 않는다 — 인용 대사 손상을 막기 위해 apply 시점에
 * 문서 대상 텍스트 기준으로 조건부 제거(resolveReplacementText)한다.
 */
export function deriveReplacementText(suggestedFix: string): string {
  return stripRichTextMarkup(suggestedFix);
}

/**
 * 교체 텍스트의 감싸는 따옴표 처리 결정:
 * - 문서 대상(matchedText)이 같은 성격의 따옴표로 감싸여 있으면(= 인용 대사)
 *   suggestion의 따옴표는 콘텐츠 → 유지.
 * - 문서 대상은 안 감싸져 있는데 suggestion만 감싸져 있으면 AI 아티팩트 → 제거.
 */
export function resolveReplacementText(baseReplacement: string, matchedText: string): string {
  const pair = getWrappingQuotePair(baseReplacement);
  if (!pair) return baseReplacement;
  const docWrapped = getWrappingQuotePair(matchedText) !== null;
  return docWrapped ? baseReplacement : stripWrappingQuotes(baseReplacement);
}

// ============================================
// 문장 단위 Fuzzy 폴백
// ============================================

/** excerpt↔문장 단어 Dice 유사도가 이 값 이상이어야 문장 매치로 인정 */
const SENTENCE_SIMILARITY_THRESHOLD = 0.6;
/** 문장 전체 교체 시 교체문이 원래 문장의 최소 이 비율 이상 길이여야 함 (조각 교체로 인한 유실 방지) */
const REPLACEMENT_MIN_LENGTH_RATIO = 0.4;
/** 유사도 판단 최소 토큰 수 (너무 짧은 excerpt는 오매치 위험) */
const MIN_EXCERPT_TOKENS = 3;

/** 유사도 비교용 토큰화: 정규화 + 소문자 + 토큰 양끝 구두점 제거 */
function tokenizeForSimilarity(text: string): Set<string> {
  return new Set(
    normalizeForSearch(text)
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
    if (b.has(word)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

/** 텍스트를 문장 범위로 분할 ([start, end) 인덱스, 공백 미정리) */
function splitSentenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      let end = i + 1;
      // 닫는 따옴표/괄호까지 문장에 포함
      while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++;
      spans.push({ start, end });
      start = end;
      i = end - 1;
    }
  }
  if (start < text.length) {
    spans.push({ start, end: text.length });
  }
  return spans;
}

export interface SentenceMatch {
  from: number;
  to: number;
  similarity: number;
  sentenceText: string;
}

/**
 * excerpt와 가장 유사한 문장을 문서에서 찾는다 (단어 Dice 유사도).
 * 블록(textblock) 내부에서만 문장을 구성하므로 반환 범위가 블록 경계를 넘지 않습니다.
 *
 * @param segmentRange - 지정 시 이 범위 안의 블록만 문장 후보로 사용 (segmentGroupId 제한).
 *   범위 밖(null)일 때는 문서 전체를 스캔하되, threshold 이상 후보가 2개 이상이면
 *   위치가 모호하므로 null을 반환한다(엉뚱한 세그먼트 문장 교체 방지).
 */
export function findBestSentenceMatch(
  doc: ProseMirrorNode,
  rawExcerpt: string | undefined,
  segmentRange?: { from: number; to: number } | null,
): SentenceMatch | null {
  if (!rawExcerpt) return null;

  const excerptTokens = tokenizeForSimilarity(stripWrappingQuotes(rawExcerpt));
  if (excerptTokens.size < MIN_EXCERPT_TOKENS) return null;

  let best: SentenceMatch | null = null;
  let qualifying = 0; // threshold 이상 후보 수 (segmentRange 없을 때 모호성 판정용)

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return undefined;
    // 범위 밖 textblock은 문장 후보에서 제외 (블록 전체가 범위 안일 때만 처리)
    if (segmentRange && (pos < segmentRange.from || pos + node.nodeSize > segmentRange.to)) {
      return false;
    }

    // 블록 내 텍스트와 문서 위치 매핑 (인라인 비텍스트 노드는 건너뜀)
    let blockText = '';
    const blockPositions: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          blockPositions.push(pos + 1 + offset + i);
        }
        blockText += child.text;
      }
    });

    for (const span of splitSentenceSpans(blockText)) {
      let s = span.start;
      let e = span.end;
      while (s < e && /\s/.test(blockText[s]!)) s++;
      while (e > s && /\s/.test(blockText[e - 1]!)) e--;
      if (e - s < 2) continue;

      const sentenceText = blockText.slice(s, e);
      const similarity = diceSimilarity(excerptTokens, tokenizeForSimilarity(sentenceText));
      if (similarity >= SENTENCE_SIMILARITY_THRESHOLD) {
        qualifying++;
        if (!best || similarity > best.similarity) {
          const from = blockPositions[s];
          const toBase = blockPositions[e - 1];
          if (from !== undefined && toBase !== undefined) {
            best = { from, to: toBase + 1, similarity, sentenceText };
          }
        }
      }
    }
    return false; // textblock 내부는 이미 처리
  });

  // 세그먼트로 제한되지 않은 전체 스캔에서 후보가 여럿이면 모호 → 포기
  if (!segmentRange && qualifying > 1) return null;

  return best;
}

export interface ResolvedSuggestionRange {
  from: number;
  to: number;
  fuzzy: boolean;
}

/**
 * 수정 제안을 적용할 문서 범위 결정:
 * 1. 정확 매치 (따옴표 관용 포함) → 해당 범위
 * 2. 실패 시 유사 문장 매치 → 문장 전체 범위 (fuzzy)
 *    단, 교체문이 문장 대비 지나치게 짧으면 유실 위험이 있어 포기
 */
export function resolveSuggestionRange(
  doc: ProseMirrorNode,
  targetExcerpt: string,
  segmentGroupId: string | undefined,
  replacement: string,
): ResolvedSuggestionRange | null {
  const exact = findExcerptRange(doc, targetExcerpt, segmentGroupId);
  if (exact) {
    return { from: exact.from, to: exact.to, fuzzy: false };
  }

  // fuzzy 폴백도 exact 경로와 동일한 세그먼트 가드를 적용한다.
  const normalizedId = normalizeSegmentGroupId(segmentGroupId);
  const segmentRange = normalizedId ? findSegmentRange(doc, normalizedId) : null;
  if (segmentGroupId && hasSegmentGroupId(doc) && !segmentRange) return null;

  const sentence = findBestSentenceMatch(doc, targetExcerpt, segmentRange);
  if (!sentence) return null;
  if (replacement.length < sentence.sentenceText.length * REPLACEMENT_MIN_LENGTH_RATIO) {
    return null;
  }
  return { from: sentence.from, to: sentence.to, fuzzy: true };
}

export type ApplySuggestionStatus = 'applied' | 'applied-fuzzy' | 'not-found' | 'missing-data';

/**
 * 이슈의 targetExcerpt를 에디터에서 찾아 suggestedFix로 교체.
 * 정확 매치 실패 시 유사 문장 전체 교체로 폴백 (applied-fuzzy).
 * plain text로 교체하며(marks 제거) history에 기록되어 Ctrl+Z 가능.
 */
export function applySuggestionToEditor(editor: Editor, issue: ReviewIssue): ApplySuggestionStatus {
  const baseReplacement = deriveReplacementText(issue.suggestedFix);
  if (!issue.targetExcerpt || !baseReplacement) return 'missing-data';

  const { state } = editor.view;
  const resolved = resolveSuggestionRange(
    state.doc,
    issue.targetExcerpt,
    issue.segmentGroupId,
    baseReplacement,
  );
  if (!resolved) return 'not-found';

  // exact 경로가 블록 경계를 넘으면 교체 시 문단이 병합되므로 포기.
  // (fuzzy 경로는 findBestSentenceMatch가 블록 내부로 한정하므로 이 가드에 걸리지 않음.)
  if (rangeCrossesBlockBoundary(state.doc, resolved.from, resolved.to)) {
    return 'not-found';
  }

  const matchedText = state.doc.textBetween(resolved.from, resolved.to, '\n');
  const replacement = resolveReplacementText(baseReplacement, matchedText);

  // 직전의 수동 입력과 같은 history 그룹으로 합쳐지지 않게 독립 undo 단위로 닫는다.
  const tr = closeHistory(
    state.tr.replaceWith(resolved.from, resolved.to, state.schema.text(replacement)),
  ).setMeta(REVIEW_SUGGESTION_APPLY_META, true);
  editor.view.dispatch(tr);
  return resolved.fuzzy ? 'applied-fuzzy' : 'applied';
}
