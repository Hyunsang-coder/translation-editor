/**
 * 번역된 청크 병합기
 *
 * 분할 번역된 청크들을 하나의 TipTap 문서로 병합합니다.
 * - 순서 보장
 * - 구조 검증
 * - 부분 실패 처리
 */

import type {
  TipTapDocJson,
  TranslationChunk,
  ChunkedTranslationResult,
} from './types';

/**
 * TipTap 문서 JSON 유효성 검증
 */
export function isValidTipTapDoc(value: unknown): value is TipTapDocJson {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return obj.type === 'doc' && Array.isArray(obj.content);
}

/**
 * 번역된 청크들을 병합하여 최종 문서 생성
 *
 * @param chunks - 번역 완료된 청크 목록
 * @returns 병합된 TipTap 문서
 */
export function mergeTranslatedChunks(
  chunks: TranslationChunk[]
): TipTapDocJson {
  // 인덱스 순으로 정렬
  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);

  // 성공한 청크의 content 병합
  const mergedContent = sortedChunks.flatMap((chunk) => {
    if (chunk.status === 'success' && chunk.result) {
      return chunk.result.content || [];
    }
    // 실패한 청크는 원본 노드 유지 (fallback)
    return chunk.nodes;
  });

  return {
    type: 'doc',
    content: mergedContent,
  };
}

/**
 * 청크 번역 결과를 종합하여 최종 결과 생성
 *
 * @param chunks - 번역된 청크 목록
 * @returns 청크 분할 번역 최종 결과
 */
export function buildChunkedTranslationResult(
  chunks: TranslationChunk[]
): ChunkedTranslationResult {
  const totalChunks = chunks.length;
  const successfulChunks = chunks.filter((c) => c.status === 'success').length;
  const failedChunkIndices = chunks
    .filter((c) => c.status === 'error')
    .map((c) => c.index);

  const allSuccess = successfulChunks === totalChunks;
  const allFailed = successfulChunks === 0;

  // 모두 실패한 경우
  if (allFailed) {
    const firstError = chunks.find((c) => c.error)?.error || '모든 청크 번역 실패';
    return {
      success: false,
      error: firstError,
      wasChunked: totalChunks > 1,
      totalChunks,
      successfulChunks: 0,
      failedChunkIndices,
    };
  }

  // 부분 성공 또는 전체 성공
  const mergedDoc = mergeTranslatedChunks(chunks);
  const mergedRaw = JSON.stringify(mergedDoc);

  // 문서 유효성 검증
  if (!isValidTipTapDoc(mergedDoc)) {
    return {
      success: false,
      error: '병합된 문서가 유효한 TipTap 형식이 아닙니다.',
      wasChunked: totalChunks > 1,
      totalChunks,
      successfulChunks,
      failedChunkIndices,
    };
  }

  return {
    success: true,
    doc: mergedDoc,
    raw: mergedRaw,
    wasChunked: totalChunks > 1,
    totalChunks,
    successfulChunks,
    failedChunkIndices: allSuccess ? [] : failedChunkIndices,
  };
}

/**
 * 실패한 청크 재시도를 위한 청크 목록 생성
 *
 * @param chunks - 원본 청크 목록
 * @param failedIndices - 재시도할 청크 인덱스 목록
 * @returns 재시도할 청크 목록 (상태 초기화됨)
 */
export function getRetryChunks(
  chunks: TranslationChunk[],
  failedIndices: number[]
): TranslationChunk[] {
  return chunks
    .filter((c) => failedIndices.includes(c.index))
    .map((c): TranslationChunk => {
      const { result: _r, error: _e, ...rest } = c;
      return {
        ...rest,
        status: 'pending',
      };
    });
}

/**
 * 청크 결과 업데이트 (불변성 유지)
 *
 * @param chunks - 원본 청크 목록
 * @param index - 업데이트할 청크 인덱스
 * @param result - 번역 결과
 * @param error - 에러 메시지 (실패 시)
 * @returns 업데이트된 청크 목록
 */
export function updateChunkResult(
  chunks: TranslationChunk[],
  index: number,
  result?: TipTapDocJson,
  error?: string
): TranslationChunk[] {
  return chunks.map((chunk) => {
    if (chunk.index !== index) return chunk;

    if (error) {
      return {
        ...chunk,
        status: 'error' as const,
        error,
      };
    }

    if (result) {
      return {
        ...chunk,
        status: 'success' as const,
        result,
      };
    }

    return chunk;
  });
}

/**
 * 청크 상태 업데이트 (불변성 유지)
 */
export function updateChunkStatus(
  chunks: TranslationChunk[],
  index: number,
  status: TranslationChunk['status']
): TranslationChunk[] {
  return chunks.map((chunk) => {
    if (chunk.index !== index) return chunk;
    return { ...chunk, status };
  });
}
