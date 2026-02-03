import { describe, it, expect, beforeEach } from 'vitest';
import { useReviewStore } from './reviewStore';
import type { AlignedChunk } from '@/ai/tools/reviewTool';

function buildChunk(index: number, groupId: string): AlignedChunk {
  return {
    chunkIndex: index,
    totalChars: 10,
    segments: [
      {
        groupId,
        order: index + 1,
        sourceText: 'source',
        targetText: 'target',
      },
    ],
  };
}

describe('reviewStore startReview', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
  });

  it('startReview에 chunks를 전달하면 진행률과 chunks가 동기화된다', () => {
    const oldChunks = [buildChunk(0, 'old')];
    useReviewStore.setState({
      chunks: oldChunks,
      progress: { completed: 0, total: oldChunks.length },
    });

    const freshChunks = [buildChunk(0, 'new-1'), buildChunk(1, 'new-2')];
    useReviewStore.getState().startReview(freshChunks);

    const state = useReviewStore.getState();
    expect(state.chunks).toHaveLength(2);
    expect(state.progress.total).toBe(2);
    expect(state.progress.completed).toBe(0);
    expect(state.currentChunkIndex).toBe(0);
    expect(state.isReviewing).toBe(true);
  });

  it('startReview에 chunks를 전달하지 않으면 기존 chunks를 사용한다', () => {
    const existingChunks = [buildChunk(0, 'a'), buildChunk(1, 'b'), buildChunk(2, 'c')];
    useReviewStore.setState({
      chunks: existingChunks,
      progress: { completed: 0, total: existingChunks.length },
    });

    useReviewStore.getState().startReview();

    const state = useReviewStore.getState();
    expect(state.chunks).toHaveLength(3);
    expect(state.progress.total).toBe(3);
  });
});
