/**
 * Markdown 기반 Context-aware 문서 분할기
 *
 * Markdown 중간 형식을 사용하여 문서를 안전하게 분할합니다.
 * - 코드블록 내부 분할 금지
 * - 리스트/blockquote 연속성 유지
 * - Heading 또는 리스트 외부 빈 줄에서만 분할
 * - 토큰 추정 기반 청크 크기 최적화
 */

import type {
  TipTapNode,
  TipTapDocJson,
  TranslationChunk,
  ChunkConfig,
  MarkdownChunk,
} from './types';

import {
  DEFAULT_CHUNK_CONFIG,
  CHUNKING_THRESHOLD,
} from './types';

import {
  tipTapJsonToMarkdown,
  markdownToTipTapJson,
  estimateMarkdownTokens,
} from '@/utils/markdownConverter';

/**
 * 텍스트 기반 토큰 수 추정 (Markdown용, JSON 오버헤드 없음)
 */
export function estimateTokenCount(text: string): number {
  return estimateMarkdownTokens(text);
}

/**
 * TipTap 노드의 토큰 수 추정 (호환성 유지)
 */
export function estimateNodeTokens(node: TipTapNode): number {
  const json = JSON.stringify(node);
  // Markdown 기준으로 추정 (JSON 오버헤드 제거)
  return Math.ceil(json.length / 3);
}

/**
 * TipTap 문서의 총 토큰 수 추정 (Markdown 기준)
 */
export function estimateDocTokens(doc: TipTapDocJson): number {
  try {
    const markdown = tipTapJsonToMarkdown(doc);
    return estimateMarkdownTokens(markdown);
  } catch {
    // 변환 실패 시 JSON 기반 추정
    const json = JSON.stringify(doc);
    return Math.ceil(json.length / 3);
  }
}

/**
 * 청킹이 필요한지 판단
 */
export function shouldChunk(doc: TipTapDocJson): boolean {
  const totalTokens = estimateDocTokens(doc);
  return totalTokens >= CHUNKING_THRESHOLD;
}

/**
 * Context-aware Markdown 분할
 *
 * - 코드블록 내부 분할 금지
 * - 리스트/blockquote 연속성 유지
 * - 안전한 분할점에서만 분할 (Heading 또는 리스트 외부 빈 줄)
 */
export function splitMarkdownSafely(
  markdown: string,
  targetTokens: number = DEFAULT_CHUNK_CONFIG.targetChunkTokens
): MarkdownChunk[] {
  const lines = markdown.split('\n');
  const chunks: MarkdownChunk[] = [];

  let currentLines: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let listIndent = 0;
  let inBlockquote = false;

  /**
   * 현재 누적된 라인들의 토큰 수 추정
   */
  function getCurrentTokens(): number {
    return estimateMarkdownTokens(currentLines.join('\n'));
  }

  /**
   * 리스트 항목인지 확인
   */
  function isListItem(line: string): { isList: boolean; indent: number } {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s/);
    if (match) {
      return { isList: true, indent: match[1]?.length ?? 0 };
    }
    return { isList: false, indent: 0 };
  }

  /**
   * 현재 청크를 저장하고 초기화
   */
  function saveChunk(): void {
    if (currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      if (content.length > 0) {
        chunks.push({
          index: chunks.length,
          markdown: content,
          estimatedTokens: estimateMarkdownTokens(content),
        });
      }
      currentLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmedLine = line.trim();

    // 코드 블록 경계 추적
    if (trimmedLine.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }

    // 코드 블록 내부에서는 분할하지 않음
    if (inCodeBlock) {
      currentLines.push(line);
      continue;
    }

    // Blockquote 추적
    if (trimmedLine.startsWith('>')) {
      inBlockquote = true;
      currentLines.push(line);
      continue;
    }

    // Blockquote 종료: 빈 줄이거나 다음 줄이 '>'로 시작하지 않으면 종료
    if (inBlockquote) {
      if (trimmedLine === '') {
        // 빈 줄이면 다음 줄 확인
        const nextLine = lines[i + 1];
        if (nextLine === undefined || !nextLine.trim().startsWith('>')) {
          inBlockquote = false;
        }
      } else {
        // 현재 줄이 '>'로 시작하지 않으면 blockquote 종료
        inBlockquote = false;
      }
    }

    // 리스트 연속성 추적
    const listInfo = isListItem(line);
    if (listInfo.isList) {
      inList = true;
      listIndent = listInfo.indent;
      currentLines.push(line);
      continue;
    }

    // 리스트 연속 (들여쓰기 또는 빈 줄 아님)
    if (inList) {
      // 리스트 내 들여쓴 내용
      const leadingSpaces = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (leadingSpaces > listIndent || trimmedLine !== '') {
        currentLines.push(line);
        // 빈 줄이 아니면 계속 리스트로 간주
        if (trimmedLine !== '') {
          continue;
        }
      }
      // 빈 줄 + 다음 줄이 리스트가 아니면 리스트 종료
      const nextLine = lines[i + 1];
      if (trimmedLine === '' && nextLine !== undefined) {
        const nextListInfo = isListItem(nextLine);
        if (!nextListInfo.isList) {
          inList = false;
        }
      }
    }

    // 안전한 분할점 판단
    const isHeading = /^#{1,6}\s/.test(line);
    const isSafeSplitPoint = !inCodeBlock && !inList && !inBlockquote &&
      (trimmedLine === '' || isHeading);

    // 토큰 목표 도달 + 안전한 분할점
    if (isSafeSplitPoint && getCurrentTokens() >= targetTokens) {
      // Heading에서 분할할 경우, heading 이전에 분할
      if (isHeading) {
        saveChunk();
        currentLines.push(line);
      } else {
        // 빈 줄에서 분할
        currentLines.push(line);
        saveChunk();
      }
      continue;
    }

    currentLines.push(line);
  }

  // 마지막 청크 저장
  saveChunk();

  return chunks;
}

/**
 * TipTap 문서를 청크로 분할 (Markdown 기반)
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

  // TipTap JSON → Markdown 변환
  let markdown: string;
  try {
    markdown = tipTapJsonToMarkdown(doc);
  } catch {
    // 변환 실패 시 단일 청크로 반환
    const totalTokens = Math.ceil(JSON.stringify(doc).length / 3);
    return [
      {
        index: 0,
        nodes: [...nodes],
        estimatedTokens: totalTokens,
        status: 'pending',
      },
    ];
  }

  const totalTokens = estimateMarkdownTokens(markdown);

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

  // Markdown 기반 분할
  const markdownChunks = splitMarkdownSafely(markdown, cfg.targetChunkTokens);

  // Markdown 청크를 TipTap 노드 청크로 변환
  const chunks: TranslationChunk[] = [];
  let hasConversionFailure = false;

  for (let index = 0; index < markdownChunks.length; index++) {
    const mdChunk = markdownChunks[index]!;
    try {
      const chunkDoc = markdownToTipTapJson(mdChunk.markdown);
      chunks.push({
        index,
        nodes: chunkDoc.content as TipTapNode[],
        estimatedTokens: mdChunk.estimatedTokens,
        status: 'pending' as const,
      });
    } catch (error) {
      // 변환 실패 로깅
      console.warn(`청크 ${index} Markdown→TipTap 변환 실패:`, error);
      hasConversionFailure = true;
      break; // 변환 실패 시 청킹 중단
    }
  }

  // 변환 실패가 있으면 단일 청크로 폴백 (원본 노드 전체 사용)
  if (hasConversionFailure) {
    console.warn('청크 변환 실패로 인해 단일 청크로 폴백합니다.');
    const totalTokens = Math.ceil(JSON.stringify({ type: 'doc', content: nodes }).length / 3);
    return [
      {
        index: 0,
        nodes: [...nodes],
        estimatedTokens: totalTokens,
        status: 'pending',
      },
    ];
  }

  return chunks.filter((c) => c.nodes.length > 0);
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
 * 문서 복잡도 계산 (호환성 유지용 - Markdown 기반 계산)
 */
export function calculateDocComplexity(doc: TipTapDocJson): number {
  try {
    const markdown = tipTapJsonToMarkdown(doc);
    let complexity = 0;

    // 리스트 항목 수
    const listItems = (markdown.match(/^[\s]*[-*+]\s/gm) || []).length;
    const numberedItems = (markdown.match(/^[\s]*\d+\.\s/gm) || []).length;
    complexity += (listItems + numberedItems) * 50;

    // 코드 블록 수
    const codeBlocks = (markdown.match(/```/g) || []).length / 2;
    complexity += codeBlocks * 100;

    // Blockquote 줄 수
    const blockquoteLines = (markdown.match(/^>/gm) || []).length;
    complexity += blockquoteLines * 30;

    return Math.min(complexity, 2500);
  } catch {
    return 0;
  }
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

// 레거시 함수들 (하위 호환성 유지)
export function identifyChunkBoundaries(): [] {
  // Markdown 기반 분할에서는 사용하지 않음
  return [];
}
