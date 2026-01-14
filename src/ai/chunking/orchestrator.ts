/**
 * 청크 분할 번역 오케스트레이터
 *
 * 문서를 청크로 분할하고 순차적으로 번역한 후 병합합니다.
 * - 진행률 콜백 지원
 * - 부분 실패 처리
 * - 재시도 로직
 */

import type { ITEProject } from '@/types';
import type {
  TipTapDocJson,
  TranslationChunk,
  ChunkedTranslationResult,
  TranslationProgressCallback,
  ChunkConfig,
} from './types';
import { DEFAULT_CHUNK_CONFIG } from './types';
import { splitDocIntoChunks, chunkToDoc, shouldChunk } from './splitter';
import {
  buildChunkedTranslationResult,
  updateChunkResult,
  updateChunkStatus,
} from './merger';

/**
 * 단일 청크 번역 함수 타입
 */
export type SingleChunkTranslator = (params: {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  translationRules?: string | undefined;
  projectContext?: string | undefined;
  translatorPersona?: string | undefined;
  glossary?: string | undefined;
  chunkIndex?: number | undefined;
  totalChunks?: number | undefined;
}) => Promise<{ doc: TipTapDocJson; raw: string }>;

/**
 * 청크 분할 번역 파라미터
 */
export interface ChunkedTranslationParams {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  translationRules?: string | undefined;
  projectContext?: string | undefined;
  translatorPersona?: string | undefined;
  /** 용어집 (source = target 형식) */
  glossary?: string | undefined;
  /** 청크 설정 */
  chunkConfig?: Partial<ChunkConfig> | undefined;
  /** 진행률 콜백 */
  onProgress?: TranslationProgressCallback | undefined;
  /** 단일 청크 번역 함수 */
  translateSingleChunk: SingleChunkTranslator;
  /** 취소 신호 */
  abortSignal?: AbortSignal | undefined;
}

/**
 * 청크 분할 번역 실행
 *
 * @param params - 번역 파라미터
 * @returns 번역 결과
 */
export async function translateInChunks(
  params: ChunkedTranslationParams
): Promise<ChunkedTranslationResult> {
  const {
    project,
    sourceDocJson,
    translationRules,
    projectContext,
    translatorPersona,
    glossary,
    chunkConfig = {},
    onProgress,
    translateSingleChunk,
    abortSignal,
  } = params;

  const config: ChunkConfig = { ...DEFAULT_CHUNK_CONFIG, ...chunkConfig };

  // 청킹이 필요한지 판단
  if (!shouldChunk(sourceDocJson)) {
    // 단일 청크로 처리
    onProgress?.({
      completed: 0,
      total: 1,
      currentChunkIndex: 0,
      status: 'translating',
    });

    try {
      const result = await translateSingleChunk({
        project,
        sourceDocJson,
        translationRules,
        projectContext,
        translatorPersona,
        glossary,
      });

      onProgress?.({
        completed: 1,
        total: 1,
        currentChunkIndex: 0,
        status: 'success',
      });

      return {
        success: true,
        doc: result.doc,
        raw: result.raw,
        wasChunked: false,
        totalChunks: 1,
        successfulChunks: 1,
        failedChunkIndices: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      onProgress?.({
        completed: 1,
        total: 1,
        currentChunkIndex: 0,
        status: 'error',
      });

      return {
        success: false,
        error: errorMessage,
        wasChunked: false,
        totalChunks: 1,
        successfulChunks: 0,
        failedChunkIndices: [0],
      };
    }
  }

  // 문서를 청크로 분할
  let chunks = splitDocIntoChunks(sourceDocJson, config);

  if (chunks.length === 0) {
    return {
      success: false,
      error: '문서를 청크로 분할할 수 없습니다.',
      wasChunked: false,
      totalChunks: 0,
      successfulChunks: 0,
      failedChunkIndices: [],
    };
  }

  const totalChunks = chunks.length;

  // 순차적으로 청크 번역
  for (let i = 0; i < chunks.length; i++) {
    // 취소 확인
    if (abortSignal?.aborted) {
      return {
        success: false,
        error: '번역이 취소되었습니다.',
        wasChunked: true,
        totalChunks,
        successfulChunks: chunks.filter((c) => c.status === 'success').length,
        failedChunkIndices: chunks
          .filter((c) => c.status !== 'success')
          .map((c) => c.index),
      };
    }

    const chunk = chunks[i]!;

    // 상태 업데이트: 번역 중
    chunks = updateChunkStatus(chunks, i, 'translating');
    onProgress?.({
      completed: i,
      total: totalChunks,
      currentChunkIndex: i,
      status: 'translating',
    });

    try {
      // 청크를 문서 형식으로 변환
      const chunkDoc = chunkToDoc(chunk);

      // 청크 번역 실행
      const result = await translateSingleChunk({
        project,
        sourceDocJson: chunkDoc,
        translationRules,
        projectContext,
        translatorPersona,
        glossary,
        chunkIndex: i,
        totalChunks,
      });

      // 성공 결과 저장
      chunks = updateChunkResult(chunks, i, result.doc);
      onProgress?.({
        completed: i + 1,
        total: totalChunks,
        currentChunkIndex: i,
        status: 'success',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 에러 결과 저장
      chunks = updateChunkResult(chunks, i, undefined, errorMessage);
      onProgress?.({
        completed: i + 1,
        total: totalChunks,
        currentChunkIndex: i,
        status: 'error',
      });

      // 청크 번역 실패 시 계속 진행 (부분 성공 허용)
      console.warn(`청크 ${i + 1}/${totalChunks} 번역 실패:`, errorMessage);
    }
  }

  // 최종 결과 생성
  return buildChunkedTranslationResult(chunks);
}

/**
 * 실패한 청크만 재시도
 *
 * @param params - 원본 번역 파라미터
 * @param previousResult - 이전 번역 결과
 * @param originalChunks - 원본 청크 목록
 * @returns 재시도 결과
 */
export async function retryFailedChunks(
  params: Omit<ChunkedTranslationParams, 'sourceDocJson'>,
  previousResult: ChunkedTranslationResult,
  originalChunks: TranslationChunk[]
): Promise<ChunkedTranslationResult> {
  const {
    project,
    translationRules,
    projectContext,
    translatorPersona,
    glossary,
    onProgress,
    translateSingleChunk,
    abortSignal,
  } = params;

  const failedIndices = previousResult.failedChunkIndices;

  if (failedIndices.length === 0) {
    return previousResult;
  }

  // 원본 청크 목록 복사 (성공한 청크는 유지)
  let chunks = [...originalChunks];
  const totalChunks = chunks.length;

  // 실패한 청크만 재시도
  for (const index of failedIndices) {
    if (abortSignal?.aborted) {
      break;
    }

    const chunk = chunks[index];
    if (!chunk) continue;

    // 상태 업데이트: 번역 중
    chunks = updateChunkStatus(chunks, index, 'translating');
    onProgress?.({
      completed: chunks.filter((c) => c.status === 'success').length,
      total: totalChunks,
      currentChunkIndex: index,
      status: 'translating',
    });

    try {
      const chunkDoc = chunkToDoc(chunk);

      const result = await translateSingleChunk({
        project,
        sourceDocJson: chunkDoc,
        translationRules,
        projectContext,
        translatorPersona,
        glossary,
        chunkIndex: index,
        totalChunks,
      });

      chunks = updateChunkResult(chunks, index, result.doc);
      onProgress?.({
        completed: chunks.filter((c) => c.status === 'success').length,
        total: totalChunks,
        currentChunkIndex: index,
        status: 'success',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      chunks = updateChunkResult(chunks, index, undefined, errorMessage);
      onProgress?.({
        completed: chunks.filter((c) => c.status === 'success').length,
        total: totalChunks,
        currentChunkIndex: index,
        status: 'error',
      });
    }
  }

  return buildChunkedTranslationResult(chunks);
}
