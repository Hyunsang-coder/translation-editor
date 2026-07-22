import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateIssueId, useReviewStore } from './reviewStore';
import { buildAlignedChunksAsync } from '@/ai/tools/reviewTool';
import type { AlignedChunk } from '@/ai/tools/reviewTool';
import type { ITEProject } from '@/types';

vi.mock('@/ai/tools/reviewTool', () => ({
  buildAlignedChunksAsync: vi.fn(async () => []),
  clearReviewChunkCache: vi.fn(),
}));

const mockBuildChunks = vi.mocked(buildAlignedChunksAsync);

function fakeProject(id: string): ITEProject {
  return { id } as unknown as ITEProject;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

describe('reviewStore triggerReview', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
  });

  it('외부 검수 실행 요청 nonce를 증가시킨다', () => {
    useReviewStore.getState().triggerReview();
    const state = useReviewStore.getState();
    expect(state.reviewTrigger).toBe(1);
  });
});

describe('reviewStore acquireReviewRun / releaseReviewRun (L4 이중 실행 가드)', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
  });

  it('유휴 상태에서 획득하면 true를 반환하고 isReviewing이 즉시 true가 된다', () => {
    const acquired = useReviewStore.getState().acquireReviewRun('p1');

    expect(acquired).toBe(true);
    const state = useReviewStore.getState();
    expect(state.isReviewing).toBe(true);
    expect(state.initializedProjectId).toBe('p1');
  });

  it('검수 중에는 획득이 실패한다 (chunk 빌드 대기 중 이중 실행 창 제거)', () => {
    expect(useReviewStore.getState().acquireReviewRun('p1')).toBe(true);
    expect(useReviewStore.getState().acquireReviewRun('p1')).toBe(false);
    expect(useReviewStore.getState().acquireReviewRun('p2')).toBe(false);
  });

  it('releaseReviewRun은 실행 슬롯만 반납하고 재획득을 허용한다', () => {
    useReviewStore.getState().acquireReviewRun('p1');
    useReviewStore.getState().releaseReviewRun();

    expect(useReviewStore.getState().isReviewing).toBe(false);
    expect(useReviewStore.getState().acquireReviewRun('p1')).toBe(true);
  });
});

describe('reviewStore initializeReview 경합 가드 (L5 requestSeq)', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
    mockBuildChunks.mockReset();
  });

  it('A→B 빠른 전환 시 늦게 끝난 A 초기화가 B 상태를 덮지 않는다', async () => {
    const buildA = deferred<AlignedChunk[]>();
    const buildB = deferred<AlignedChunk[]>();
    mockBuildChunks
      .mockImplementationOnce(() => buildA.promise)
      .mockImplementationOnce(() => buildB.promise);

    const initA = useReviewStore.getState().initializeReview(fakeProject('A'));
    const initB = useReviewStore.getState().initializeReview(fakeProject('B'));

    // B가 먼저 완료
    buildB.resolve([buildChunk(0, 'b-seg')]);
    await initB;
    expect(useReviewStore.getState().initializedProjectId).toBe('B');

    // 늦게 도착한 A는 폐기되어야 함
    buildA.resolve([buildChunk(0, 'a-seg-1'), buildChunk(1, 'a-seg-2')]);
    await initA;

    const state = useReviewStore.getState();
    expect(state.initializedProjectId).toBe('B');
    expect(state.chunks).toHaveLength(1);
    expect(state.progress.total).toBe(1);
  });

  it('같은 프로젝트에서 검수 실행이 시작된 뒤 도착한 초기화는 실행 상태를 덮지 않는다', async () => {
    const build = deferred<AlignedChunk[]>();
    mockBuildChunks.mockImplementationOnce(() => build.promise);

    const init = useReviewStore.getState().initializeReview(fakeProject('A'));
    // 초기화가 끝나기 전에 사용자가 검수 시작 (acquireReviewRun이 실행 슬롯 선점)
    useReviewStore.getState().acquireReviewRun('A');

    build.resolve([buildChunk(0, 'seg')]);
    await init;

    expect(useReviewStore.getState().isReviewing).toBe(true);
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

  it('외부 주입 텍스트도 정규화하고 정규화된 excerpt로 ID를 생성한다', () => {
    useReviewStore.getState().ingestExternalReview({
      projectId: 'p1',
      issues: [{
        sourceExcerpt: '**source**',
        targetExcerpt: '&lt;strong&gt;target&lt;/strong&gt;',
        suggestedFix: '&lt;a href=&quot;https://example.com&quot;&gt;fixed&lt;/a&gt;',
        type: 'mistranslation',
        severity: 'major',
        description: '**description**',
      }],
    });

    const issue = useReviewStore.getState().getAllIssues()[0]!;
    expect(issue).toMatchObject({
      sourceExcerpt: 'source',
      targetExcerpt: 'target',
      suggestedFix: 'fixed',
      description: 'description',
    });
    expect(issue.id).toBe(generateIssueId(0, 'mistranslation', 'source', 'target'));
  });
});
