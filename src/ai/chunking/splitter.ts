/**
 * TipTap 문서 청크 분할기
 *
 * 문서를 논리적 단위로 분할하여 번역 성능을 개선합니다.
 * - Heading, HorizontalRule에서 우선 분할
 * - 리스트, 블록쿼트 등 중첩 구조는 내부 분할 금지
 * - 토큰 추정 기반 청크 크기 최적화
 */

import type {
  TipTapNode,
  TipTapDocJson,
  TranslationChunk,
  ChunkBoundary,
  ChunkConfig,
} from './types';

import {
  DEFAULT_CHUNK_CONFIG,
  CHUNKING_THRESHOLD,
  COMPLEXITY_MULTIPLIER,
  SPLIT_PRIORITY,
  NO_SPLIT_TYPES,
} from './types';

/**
 * 텍스트 기반 토큰 수 추정
 * - 영어: 약 4자 = 1토큰
 * - 한글: 약 2자 = 1토큰
 * - JSON 구조 오버헤드 약 20% 추가
 */
export function estimateTokenCount(text: string): number {
  const chars = text.length;
  // 평균적으로 3자당 1토큰으로 추정 (한영 혼용 고려)
  const estimatedTokens = Math.ceil(chars / 3);
  // JSON 구조 오버헤드 20% 추가
  return Math.ceil(estimatedTokens * 1.2);
}

/**
 * TipTap 노드의 토큰 수 추정
 */
export function estimateNodeTokens(node: TipTapNode): number {
  const json = JSON.stringify(node);
  return estimateTokenCount(json);
}

/**
 * TipTap 문서의 총 토큰 수 추정
 */
export function estimateDocTokens(doc: TipTapDocJson): number {
  const json = JSON.stringify(doc);
  return estimateTokenCount(json);
}

/**
 * 노드가 분할 금지 타입인지 확인
 */
function isNoSplitType(nodeType: string): boolean {
  return NO_SPLIT_TYPES.has(nodeType);
}

/**
 * 노드의 분할 우선순위 반환
 */
function getSplitPriority(nodeType: string): number {
  return SPLIT_PRIORITY[nodeType] ?? 4; // 기본값: paragraph 수준
}

/**
 * 문서 노드들의 분할 경계점 탐지
 *
 * @param nodes - 문서의 최상위 노드들
 * @returns 분할 경계점 목록 (우선순위 순 정렬)
 */
export function identifyChunkBoundaries(nodes: TipTapNode[]): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = [];
  let cumulativeTokens = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;

    const nodeTokens = estimateNodeTokens(node);
    cumulativeTokens += nodeTokens;

    // 분할 금지 타입은 경계점으로 추가하지 않음 (단, 전체 노드로서는 분할점이 될 수 있음)
    if (!isNoSplitType(node.type)) {
      boundaries.push({
        nodeIndex: i,
        nodeType: node.type,
        priority: getSplitPriority(node.type),
        estimatedTokens: cumulativeTokens,
      });
    } else {
      // 분할 금지 타입도 노드 경계로는 분할점이 될 수 있음 (내부 분할만 금지)
      boundaries.push({
        nodeIndex: i,
        nodeType: node.type,
        priority: getSplitPriority(node.type),
        estimatedTokens: cumulativeTokens,
      });
    }
  }

  return boundaries;
}

/**
 * 최적의 분할점 선택
 *
 * @param boundaries - 분할 경계점 목록
 * @param startIndex - 시작 노드 인덱스
 * @param targetTokens - 목표 토큰 수
 * @param maxTokens - 최대 토큰 수
 * @param startTokens - 시작 시점의 누적 토큰 수
 * @returns 분할할 노드 인덱스 (해당 인덱스까지 포함)
 */
function findOptimalSplitPoint(
  boundaries: ChunkBoundary[],
  startIndex: number,
  targetTokens: number,
  maxTokens: number,
  startTokens: number
): number {
  // 현재 범위의 경계점들 필터
  const relevantBoundaries = boundaries.filter(
    (b) => b.nodeIndex >= startIndex
  );

  if (relevantBoundaries.length === 0) {
    return boundaries.length > 0
      ? boundaries[boundaries.length - 1]!.nodeIndex
      : startIndex;
  }

  // 목표 토큰 범위 내의 최적 분할점 찾기
  let bestCandidate: ChunkBoundary | null = null;

  for (const boundary of relevantBoundaries) {
    const chunkTokens = boundary.estimatedTokens - startTokens;

    // 최대 토큰 초과 시 이전 후보 반환
    if (chunkTokens > maxTokens) {
      break;
    }

    // 목표 토큰에 가까워지면서 우선순위가 높은 분할점 선호
    if (
      !bestCandidate ||
      (chunkTokens <= targetTokens && boundary.priority <= bestCandidate.priority) ||
      (bestCandidate.estimatedTokens - startTokens < targetTokens * 0.5 && chunkTokens <= targetTokens)
    ) {
      bestCandidate = boundary;
    }

    // 목표 토큰을 넘었지만 아직 최대 범위 내라면 저장
    if (chunkTokens > targetTokens && chunkTokens <= maxTokens) {
      if (!bestCandidate || boundary.priority < bestCandidate.priority) {
        bestCandidate = boundary;
      }
      // 우선순위 1인 분할점을 찾으면 바로 사용
      if (boundary.priority === 1) {
        break;
      }
    }
  }

  // 후보가 없으면 마지막 경계점 사용
  if (!bestCandidate) {
    const lastBoundary = relevantBoundaries[relevantBoundaries.length - 1];
    return lastBoundary?.nodeIndex ?? startIndex;
  }

  return bestCandidate.nodeIndex;
}

/**
 * TipTap 문서를 청크로 분할
 *
 * @param doc - TipTap 문서 JSON
 * @param config - 청크 설정 (선택적)
 * @returns 분할된 청크 목록
 */
export function splitDocIntoChunks(
  doc: TipTapDocJson,
  config: Partial<ChunkConfig> = {}
): TranslationChunk[] {
  const cfg: ChunkConfig = { ...DEFAULT_CHUNK_CONFIG, ...config };
  const nodes = doc.content || [];

  if (nodes.length === 0) {
    return [];
  }

  // 전체 토큰 수 추정
  const totalTokens = estimateDocTokens(doc);

  // 청킹 임계값 미만이면 단일 청크 반환
  if (totalTokens < CHUNKING_THRESHOLD) {
    return [
      {
        index: 0,
        nodes: [...nodes],
        estimatedTokens: totalTokens,
        status: 'pending',
      },
    ];
  }

  // 분할 경계점 탐지
  const boundaries = identifyChunkBoundaries(nodes);
  const chunks: TranslationChunk[] = [];

  let currentStartIndex = 0;
  let currentStartTokens = 0;
  let chunkIndex = 0;

  while (currentStartIndex < nodes.length) {
    // 최적 분할점 찾기
    const endIndex = findOptimalSplitPoint(
      boundaries,
      currentStartIndex,
      cfg.targetChunkTokens,
      cfg.maxChunkTokens,
      currentStartTokens
    );

    // 청크 노드 추출
    const chunkNodes = nodes.slice(currentStartIndex, endIndex + 1);

    if (chunkNodes.length === 0) {
      // 안전장치: 무한 루프 방지
      if (currentStartIndex < nodes.length) {
        chunkNodes.push(nodes[currentStartIndex]!);
        currentStartIndex++;
      }
      break;
    }

    // 청크 토큰 수 계산
    const chunkTokens = chunkNodes.reduce(
      (sum, node) => sum + estimateNodeTokens(node),
      0
    );

    chunks.push({
      index: chunkIndex,
      nodes: chunkNodes,
      estimatedTokens: chunkTokens,
      status: 'pending',
    });

    // 다음 청크 시작점 설정
    currentStartIndex = endIndex + 1;
    currentStartTokens =
      boundaries.find((b) => b.nodeIndex === endIndex)?.estimatedTokens ?? currentStartTokens + chunkTokens;
    chunkIndex++;
  }

  return chunks;
}

/**
 * 청크를 TipTap 문서 형식으로 변환
 */
export function chunkToDoc(chunk: TranslationChunk): TipTapDocJson {
  return {
    type: 'doc',
    content: chunk.nodes,
  };
}

/**
 * 문서 복잡도 계산 (리스트/중첩 구조 분석)
 *
 * @param doc - TipTap 문서
 * @returns 복잡도 점수 (토큰 단위로 환산)
 */
export function calculateDocComplexity(doc: TipTapDocJson): number {
  let listItemCount = 0;
  let maxNestingLevel = 0;

  function countComplexity(nodes: TipTapNode[], level: number): void {
    for (const node of nodes) {
      // 중첩 레벨 추적
      if (level > maxNestingLevel) {
        maxNestingLevel = level;
      }

      // 리스트 항목 카운트
      if (node.type === 'listItem') {
        listItemCount++;
      }

      // 자식 노드 재귀 탐색
      if (node.content && Array.isArray(node.content)) {
        const nestTypes = new Set(['bulletList', 'orderedList', 'blockquote', 'listItem']);
        const nextLevel = nestTypes.has(node.type) ? level + 1 : level;
        countComplexity(node.content, nextLevel);
      }
    }
  }

  countComplexity(doc.content || [], 0);

  // 복잡도 점수 계산
  const listPenalty = listItemCount * COMPLEXITY_MULTIPLIER.listItemWeight;
  const nestingPenalty = maxNestingLevel * COMPLEXITY_MULTIPLIER.nestingLevelWeight;
  const totalPenalty = Math.min(
    listPenalty + nestingPenalty,
    COMPLEXITY_MULTIPLIER.maxComplexityPenalty
  );

  return totalPenalty;
}

/**
 * 청킹이 필요한지 판단
 * - 토큰 수 기준 + 복잡도 보정
 * - 리스트/중첩 구조가 많으면 더 적극적으로 청킹
 */
export function shouldChunk(doc: TipTapDocJson): boolean {
  const totalTokens = estimateDocTokens(doc);
  const complexity = calculateDocComplexity(doc);

  // 복잡도가 높으면 임계값을 낮춤
  const adjustedThreshold = Math.max(
    CHUNKING_THRESHOLD - complexity,
    DEFAULT_CHUNK_CONFIG.minChunkTokens
  );

  return totalTokens >= adjustedThreshold;
}

/**
 * 청크 분할 정보 반환 (디버깅/로깅용)
 */
export function getChunkingInfo(doc: TipTapDocJson): {
  totalTokens: number;
  complexity: number;
  adjustedThreshold: number;
  shouldChunk: boolean;
  estimatedChunks: number;
} {
  const totalTokens = estimateDocTokens(doc);
  const complexity = calculateDocComplexity(doc);
  const adjustedThreshold = Math.max(
    CHUNKING_THRESHOLD - complexity,
    DEFAULT_CHUNK_CONFIG.minChunkTokens
  );
  const needsChunking = totalTokens >= adjustedThreshold;

  let estimatedChunks = 1;
  if (needsChunking) {
    estimatedChunks = Math.ceil(totalTokens / DEFAULT_CHUNK_CONFIG.targetChunkTokens);
  }

  return {
    totalTokens,
    complexity,
    adjustedThreshold,
    shouldChunk: needsChunking,
    estimatedChunks,
  };
}
