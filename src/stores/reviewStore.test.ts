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

describe('reviewStore ingestExternalReview', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
  });

  it('주입 시 checked:true·highlightEnabled·initializedProjectId가 한 번에 세팅된다', () => {
    useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{
        sourceExcerpt: 'src', targetExcerpt: 'tgt',
        type: 'mistranslation', severity: 'major', description: 'd',
      }],
    });
    const s = useReviewStore.getState();
    expect(s.results).toHaveLength(1);
    expect(s.results[0]!.issues[0]!.checked).toBe(true);
    expect(s.highlightEnabled).toBe(true);
    expect(s.initializedProjectId).toBe('p1');
    expect(s.totalIssuesFound).toBe(1);
  });

  it('severityFilter가 좁혀져 있어도 주입이 3값 전체로 리셋한다 (함정 4)', () => {
    useReviewStore.setState({ severityFilter: ['critical'] });
    useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{ sourceExcerpt: 's', targetExcerpt: 't', type: 'omission', severity: 'minor', description: 'd' }],
    });
    expect(useReviewStore.getState().severityFilter).toEqual(['critical', 'major', 'minor']);
    expect(useReviewStore.getState().getCheckedIssues()).toHaveLength(1);
  });

  it('주입은 append가 아니라 전체 교체다', () => {
    const inject = (txt: string) => useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{ sourceExcerpt: 's', targetExcerpt: txt, type: 'grammar', severity: 'major', description: 'd' }],
    });
    inject('first'); inject('second');
    const issues = useReviewStore.getState().getAllIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.targetExcerpt).toBe('second');
  });
});
