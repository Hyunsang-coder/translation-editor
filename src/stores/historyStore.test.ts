import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBlock, HistorySnapshotMeta } from '@/types';

const tauriHistoryMock = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  getSnapshot: vi.fn(),
  listHistory: vi.fn(),
  renameSnapshot: vi.fn(),
}));

vi.mock('@/tauri/history', () => tauriHistoryMock);

import { useHistoryStore } from './historyStore';

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const blockFixture: Record<string, EditorBlock> = {
  'target-1': {
    id: 'target-1',
    type: 'target',
    content: '<p>안녕하세요</p>',
    hash: 'hash-target-1',
    metadata: {
      createdAt: 1,
      updatedAt: 1,
      tags: [],
    },
  },
};

describe('historyStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHistoryStore.getState().reset();
  });

  it('createSnapshot은 생성 성공 후 목록 갱신 실패가 나도 성공으로 반환한다', async () => {
    tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-1');
    tauriHistoryMock.listHistory.mockRejectedValue(new Error('list failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      useHistoryStore.getState().createSnapshot({
        projectId: 'project-1',
        description: 'manual snapshot',
        blocks: blockFixture,
      }),
    ).resolves.toBe('snapshot-1');

    expect(tauriHistoryMock.createSnapshot).toHaveBeenCalledTimes(1);
    expect(tauriHistoryMock.listHistory).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().error).toBeNull();

    warnSpy.mockRestore();
  });

  it('loadHistory는 늦게 도착한 이전 요청 응답으로 최신 목록을 덮어쓰지 않는다', async () => {
    const oldRequest = createDeferred<HistorySnapshotMeta[]>();
    const latestRequest = createDeferred<HistorySnapshotMeta[]>();

    tauriHistoryMock.listHistory
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => latestRequest.promise);

    const first = useHistoryStore.getState().loadHistory('project-old');
    const second = useHistoryStore.getState().loadHistory('project-new');

    latestRequest.resolve([
      {
        id: 'new-snapshot',
        timestamp: 200,
        description: 'new',
      },
    ]);
    await second;

    oldRequest.resolve([
      {
        id: 'old-snapshot',
        timestamp: 100,
        description: 'old',
      },
    ]);
    await first;

    expect(useHistoryStore.getState().snapshots).toEqual([
      {
        id: 'new-snapshot',
        timestamp: 200,
        description: 'new',
      },
    ]);
  });

  it('renameSnapshot은 성공 시 목록의 description을 갱신한다', async () => {
    useHistoryStore.setState({
      snapshots: [
        {
          id: 'snapshot-1',
          timestamp: 100,
          description: 'before',
        },
      ],
    });
    tauriHistoryMock.renameSnapshot.mockResolvedValue(undefined);

    await useHistoryStore.getState().renameSnapshot({
      projectId: 'project-1',
      snapshotId: 'snapshot-1',
      description: 'after',
    });

    expect(tauriHistoryMock.renameSnapshot).toHaveBeenCalledWith({
      projectId: 'project-1',
      snapshotId: 'snapshot-1',
      description: 'after',
    });
    expect(useHistoryStore.getState().snapshots[0]?.description).toBe('after');
  });
});
