import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateIssueId, useReviewStore, type ReviewIssue } from './reviewStore';
import { buildAlignedChunksAsync } from '@/ai/tools/reviewTool';
import type { AlignedChunk } from '@/ai/tools/reviewTool';
import type { ITEProject } from '@/types';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

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

function buildIssue(id: string): ReviewIssue {
  return {
    id,
    segmentOrder: 0,
    segmentGroupId: undefined,
    sourceExcerpt: `source-${id}`,
    targetExcerpt: `target-${id}`,
    suggestedFix: `fix-${id}`,
    type: 'mistranslation',
    severity: 'major',
    description: `description-${id}`,
    checked: true,
  };
}

function fakeDoc(id: string): ProseMirrorNode {
  return {
    __testId: id,
    eq(other: { __testId?: string }) {
      return other.__testId === id;
    },
  } as unknown as ProseMirrorNode;
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

describe('reviewStore requestReviewRun / consumePendingReviewRun', () => {
  beforeEach(() => {
    useReviewStore.getState().resetReview();
  });

  it('요청은 소비될 때까지 상태로 남는다 (패널이 나중에 마운트돼도 집어갈 수 있어야 한다)', () => {
    useReviewStore.getState().requestReviewRun('용어 일관성 위주로');

    expect(useReviewStore.getState().pendingReviewRun).toEqual({ instruction: '용어 일관성 위주로' });

    expect(useReviewStore.getState().consumePendingReviewRun()).toEqual({ instruction: '용어 일관성 위주로' });
    expect(useReviewStore.getState().pendingReviewRun).toBeNull();
    expect(useReviewStore.getState().consumePendingReviewRun()).toBeNull();
  });

  it('지시사항 없이 요청하면 빈 문자열이 된다', () => {
    useReviewStore.getState().requestReviewRun();
    expect(useReviewStore.getState().pendingReviewRun).toEqual({ instruction: '' });
  });

  it('검수 중에는 요청을 무시한다', () => {
    useReviewStore.getState().acquireReviewRun('p1');
    useReviewStore.getState().requestReviewRun('무시되어야 함');
    expect(useReviewStore.getState().pendingReviewRun).toBeNull();
  });

  it('범위를 함께 실어 보내면 소비 시 그대로 나온다', () => {
    const scope = { targetUnitIds: ['u1', 'u2'], label: '문단 2개' };
    useReviewStore.getState().requestReviewRun('', scope);

    expect(useReviewStore.getState().consumePendingReviewRun()).toEqual({
      instruction: '',
      scope,
    });
  });

  it('범위 없이 요청하면 scope 키가 붙지 않는다 (기존 호출부 호환)', () => {
    useReviewStore.getState().requestReviewRun('전체 검수');

    expect(useReviewStore.getState().consumePendingReviewRun()).toEqual({
      instruction: '전체 검수',
    });
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

describe('reviewStore ignoreIssue / undoIgnoredIssue', () => {
  const firstIssue = buildIssue('issue-first');
  const secondIssue = buildIssue('issue-second');

  beforeEach(() => {
    useReviewStore.getState().resetReview();
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [firstIssue, secondIssue] }],
      initializedProjectId: 'project-ignore',
      totalIssuesFound: 2,
      highlightEnabled: true,
    });
  });

  it('원본 결과를 삭제하지 않고 무시한 이슈만 목록과 하이라이트 입력에서 숨긴다', () => {
    const actionId = useReviewStore.getState().ignoreIssue({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
    });

    expect(actionId).toEqual(expect.any(String));
    expect(useReviewStore.getState().results[0]?.issues).toEqual([firstIssue, secondIssue]);
    expect(useReviewStore.getState().getAllIssues()).toEqual([secondIssue]);
    expect(useReviewStore.getState().reviewActionHistory).toContainEqual(expect.objectContaining({
      actionId,
      kind: 'ignored',
      issueId: firstIssue.id,
      state: 'resolved',
    }));
  });

  it('무시 작업 ID를 되돌리면 원래 이슈와 체크 상태를 그대로 복원한다', () => {
    const actionId = useReviewStore.getState().ignoreIssue({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
    });
    expect(actionId).not.toBeNull();

    const restored = useReviewStore.getState().undoIgnoredIssue(actionId!);

    expect(restored).toBe(true);
    expect(useReviewStore.getState().getAllIssues()).toEqual([firstIssue, secondIssue]);
    expect(useReviewStore.getState().reviewActionHistory).toContainEqual(expect.objectContaining({
      actionId,
      state: 'undone',
    }));
  });

  it('여러 항목을 무시한 뒤 과거 작업을 눌러도 그 작업의 항목만 복원한다', () => {
    const firstActionId = useReviewStore.getState().ignoreIssue({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
    });
    useReviewStore.getState().ignoreIssue({
      issueId: secondIssue.id,
      projectId: 'project-ignore',
    });

    expect(useReviewStore.getState().getAllIssues()).toEqual([]);
    expect(useReviewStore.getState().undoIgnoredIssue(firstActionId!)).toBe(true);
    expect(useReviewStore.getState().getAllIssues()).toEqual([firstIssue]);
  });

  it('검수가 초기화된 뒤 오래된 작업 ID는 같은 이슈를 잘못 복원하지 않는다', () => {
    const staleActionId = useReviewStore.getState().ignoreIssue({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
    });

    useReviewStore.getState().resetReview();
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [firstIssue] }],
      initializedProjectId: 'project-ignore',
    });

    expect(useReviewStore.getState().undoIgnoredIssue(staleActionId!)).toBe(false);
    expect(useReviewStore.getState().getAllIssues()).toEqual([firstIssue]);
  });

  it('검수 완료 집계는 무시로 숨긴 항목도 발견된 전체 건수에 포함한다', () => {
    useReviewStore.getState().ignoreIssue({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
    });

    useReviewStore.getState().finishReview();

    expect(useReviewStore.getState().getAllIssues()).toEqual([secondIssue]);
    expect(useReviewStore.getState().totalIssuesFound).toBe(2);
  });

  it('적용 redo와 무시가 겹쳐도 한 작업만 되돌려 해결 상태가 풀리지 않는다', () => {
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [firstIssue] }],
      totalIssuesFound: 1,
    });
    const beforeDoc = fakeDoc('before');
    const afterDoc = fakeDoc('after');
    useReviewStore.getState().recordAppliedSuggestion({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
      beforeDoc,
      afterDoc,
    });
    expect(useReviewStore.getState().reconcileAppliedSuggestionTransaction({
      projectId: 'project-ignore',
      beforeDoc: afterDoc,
      afterDoc: beforeDoc,
    })).toBe('undone');
    const ignoreActionId = useReviewStore.getState().ignoreIssue({
      issueId: firstIssue.id,
      projectId: 'project-ignore',
    });

    expect(useReviewStore.getState().reconcileAppliedSuggestionTransaction({
      projectId: 'project-ignore',
      beforeDoc,
      afterDoc,
    })).toBe('redone');
    expect(useReviewStore.getState().undoIgnoredIssue(ignoreActionId!)).toBe(true);

    expect(useReviewStore.getState().getAllIssues()).toEqual([]);
  });

  it('되돌리기 이력 한도를 넘겨도 먼저 무시한 항목이 다시 나타나지 않는다', () => {
    const issues = Array.from({ length: 101 }, (_, index) => buildIssue(`issue-${index}`));
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues }],
      initializedProjectId: 'project-ignore',
      resolvedIssueIds: [],
      reviewActionHistory: [],
    });

    for (const issue of issues) {
      useReviewStore.getState().ignoreIssue({
        issueId: issue.id,
        projectId: 'project-ignore',
      });
    }

    expect(useReviewStore.getState().reviewActionHistory).toHaveLength(100);
    expect(useReviewStore.getState().resolvedIssueIds).toHaveLength(101);
    expect(useReviewStore.getState().getAllIssues()).toEqual([]);
  });

  it('무시 이력이 많아져도 편집기 undo와 연결된 적용 이력을 밀어내지 않는다', () => {
    const appliedIssue = buildIssue('applied-issue');
    const ignoredIssues = Array.from({ length: 101 }, (_, index) => buildIssue(`ignored-${index}`));
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues: [appliedIssue, ...ignoredIssues] }],
      initializedProjectId: 'project-ignore',
      resolvedIssueIds: [],
      reviewActionHistory: [],
    });
    const beforeDoc = fakeDoc('history-before');
    const afterDoc = fakeDoc('history-after');
    useReviewStore.getState().recordAppliedSuggestion({
      issueId: appliedIssue.id,
      projectId: 'project-ignore',
      beforeDoc,
      afterDoc,
    });

    for (const issue of ignoredIssues) {
      useReviewStore.getState().ignoreIssue({
        issueId: issue.id,
        projectId: 'project-ignore',
      });
    }

    expect(useReviewStore.getState().reviewActionHistory.some((entry) =>
      entry.kind === 'applied' && entry.issueId === appliedIssue.id,
    )).toBe(true);
    expect(useReviewStore.getState().reconcileAppliedSuggestionTransaction({
      projectId: 'project-ignore',
      beforeDoc: afterDoc,
      afterDoc: beforeDoc,
    })).toBe('undone');
    expect(useReviewStore.getState().getAllIssues()).toContainEqual(appliedIssue);
  });
});
