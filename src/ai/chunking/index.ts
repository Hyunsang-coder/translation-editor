/**
 * 청크 분할 번역 모듈
 *
 * 복잡한 서식 문서의 번역 성능 개선을 위한 모듈입니다.
 * - 문서를 논리적 단위로 분할
 * - 순차 번역 후 병합
 * - 진행률 추적 및 부분 실패 처리
 */

// 타입 내보내기
export type {
  TipTapNode,
  TipTapDocJson,
  TranslationChunk,
  TranslationChunkStatus,
  ChunkBoundary,
  ChunkConfig,
  ChunkedTranslationState,
  ChunkedTranslationResult,
  ChunkTranslationResult,
  TranslationProgressCallback,
} from './types';

export {
  DEFAULT_CHUNK_CONFIG,
  CHUNKING_THRESHOLD,
  COMPLEXITY_MULTIPLIER,
  SPLIT_PRIORITY,
  NO_SPLIT_TYPES,
} from './types';

// 분할 함수 내보내기
export {
  estimateTokenCount,
  estimateNodeTokens,
  estimateDocTokens,
  identifyChunkBoundaries,
  splitDocIntoChunks,
  chunkToDoc,
  calculateDocComplexity,
  shouldChunk,
  getChunkingInfo,
} from './splitter';

// 병합 함수 내보내기
export {
  isValidTipTapDoc,
  mergeTranslatedChunks,
  buildChunkedTranslationResult,
  getRetryChunks,
  updateChunkResult,
  updateChunkStatus,
} from './merger';

// 오케스트레이터 내보내기
export type {
  SingleChunkTranslator,
  ChunkedTranslationParams,
} from './orchestrator';

export {
  translateInChunks,
  retryFailedChunks,
} from './orchestrator';
