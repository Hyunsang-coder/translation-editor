import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBlock, HistorySnapshot, HistorySnapshotMeta } from '@/types';
import { hashContent } from '@/utils/hash';

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

const blockFixture2: Record<string, EditorBlock> = {
  'target-1': {
    id: 'target-1',
    type: 'target',
    content: '<p>Hello World</p>',
    hash: 'hash-target-2',
    metadata: {
      createdAt: 2,
      updatedAt: 2,
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

    tauriHistoryMock.getSnapshot.mockResolvedValue({ snapshotJson: '{}' });
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

  it('createSnapshot은 reset 이후 늦게 도착한 목록 응답을 반영하지 않는다', async () => {
    const deferredList = createDeferred<HistorySnapshotMeta[]>();
    tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-1');
    tauriHistoryMock.listHistory.mockImplementationOnce(() => deferredList.promise);

    const createPromise = useHistoryStore.getState().createSnapshot({
      projectId: 'project-1',
      description: 'manual snapshot',
      blocks: blockFixture,
    });

    useHistoryStore.getState().reset();
    deferredList.resolve([
      {
        id: 'late-snapshot',
        timestamp: 200,
        description: 'late',
      },
    ]);

    await expect(createPromise).resolves.toBe('snapshot-1');
    expect(useHistoryStore.getState().snapshots).toEqual([]);
  });

  it('deleteSnapshot은 reset 이후 늦게 도착한 목록 응답을 반영하지 않는다', async () => {
    const deferredList = createDeferred<HistorySnapshotMeta[]>();
    tauriHistoryMock.deleteSnapshot.mockResolvedValue(undefined);
    tauriHistoryMock.listHistory.mockImplementationOnce(() => deferredList.promise);

    const deletePromise = useHistoryStore.getState().deleteSnapshot({
      projectId: 'project-1',
      snapshotId: 'snapshot-1',
    });

    useHistoryStore.getState().reset();
    deferredList.resolve([
      {
        id: 'late-snapshot',
        timestamp: 200,
        description: 'late',
      },
    ]);

    await expect(deletePromise).resolves.toBeUndefined();
    expect(useHistoryStore.getState().snapshots).toEqual([]);
  });

  it('createSnapshot은 성공 후 latestBlocksHash를 갱신한다', async () => {
    tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-1');
    tauriHistoryMock.listHistory.mockResolvedValue([]);

    await useHistoryStore.getState().createSnapshot({
      projectId: 'project-1',
      description: 'test',
      blocks: blockFixture,
    });

    expect(useHistoryStore.getState().latestBlocksHash).toBe(
      hashContent(JSON.stringify(blockFixture)),
    );
  });

  describe('createSnapshotIfChanged', () => {
    it('캐시된 해시와 동일하면 스냅샷을 생성하지 않고 null을 반환한다', async () => {
      // Pre-set latestBlocksHash to match blockFixture
      useHistoryStore.setState({
        latestBlocksHash: hashContent(JSON.stringify(blockFixture)),
      });

      const result = await useHistoryStore.getState().createSnapshotIfChanged({
        projectId: 'project-1',
        description: 'auto snapshot',
        blocks: blockFixture,
      });

      expect(result).toBeNull();
      expect(tauriHistoryMock.createSnapshot).not.toHaveBeenCalled();
    });

    it('캐시된 해시와 다르면 스냅샷을 생성하고 ID를 반환한다', async () => {
      useHistoryStore.setState({
        latestBlocksHash: hashContent(JSON.stringify(blockFixture)),
      });
      tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-new');
      tauriHistoryMock.listHistory.mockResolvedValue([]);

      const result = await useHistoryStore.getState().createSnapshotIfChanged({
        projectId: 'project-1',
        description: 'auto snapshot',
        blocks: blockFixture2,
      });

      expect(result).toBe('snapshot-new');
      expect(tauriHistoryMock.createSnapshot).toHaveBeenCalledTimes(1);
    });

    it('캐시가 null이고 스냅샷이 없으면 새 스냅샷을 생성한다', async () => {
      useHistoryStore.setState({ latestBlocksHash: null, snapshots: [] });
      tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-first');
      tauriHistoryMock.listHistory.mockResolvedValue([]);

      const result = await useHistoryStore.getState().createSnapshotIfChanged({
        projectId: 'project-1',
        description: 'auto snapshot',
        blocks: blockFixture,
      });

      expect(result).toBe('snapshot-first');
      expect(tauriHistoryMock.createSnapshot).toHaveBeenCalledTimes(1);
    });

    it('캐시가 null이고 최신 스냅샷과 동일하면 스킵한다', async () => {
      useHistoryStore.setState({
        latestBlocksHash: null,
        snapshots: [{ id: 'snap-1', timestamp: 100, description: 'prev' }],
      });
      tauriHistoryMock.getSnapshot.mockResolvedValue({
        id: 'snap-1',
        timestamp: 100,
        description: 'prev',
        blockChanges: [],
        snapshotJson: JSON.stringify(blockFixture),
      } satisfies HistorySnapshot);

      const result = await useHistoryStore.getState().createSnapshotIfChanged({
        projectId: 'project-1',
        description: 'auto snapshot',
        blocks: blockFixture,
      });

      expect(result).toBeNull();
      expect(tauriHistoryMock.createSnapshot).not.toHaveBeenCalled();
      // Hash cache should be populated after comparison
      expect(useHistoryStore.getState().latestBlocksHash).toBe(
        hashContent(JSON.stringify(blockFixture)),
      );
    });

    it('캐시가 null이고 최신 스냅샷과 다르면 새 스냅샷을 생성한다', async () => {
      useHistoryStore.setState({
        latestBlocksHash: null,
        snapshots: [{ id: 'snap-1', timestamp: 100, description: 'prev' }],
      });
      tauriHistoryMock.getSnapshot.mockResolvedValue({
        id: 'snap-1',
        timestamp: 100,
        description: 'prev',
        blockChanges: [],
        snapshotJson: JSON.stringify(blockFixture),
      } satisfies HistorySnapshot);
      tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-new');
      tauriHistoryMock.listHistory.mockResolvedValue([]);

      const result = await useHistoryStore.getState().createSnapshotIfChanged({
        projectId: 'project-1',
        description: 'auto snapshot',
        blocks: blockFixture2,
      });

      expect(result).toBe('snapshot-new');
      expect(tauriHistoryMock.createSnapshot).toHaveBeenCalledTimes(1);
    });

    it('getSnapshot 실패 시에도 스냅샷을 생성한다', async () => {
      useHistoryStore.setState({
        latestBlocksHash: null,
        snapshots: [{ id: 'snap-1', timestamp: 100, description: 'prev' }],
      });
      tauriHistoryMock.getSnapshot.mockRejectedValue(new Error('load failed'));
      tauriHistoryMock.createSnapshot.mockResolvedValue('snapshot-fallback');
      tauriHistoryMock.listHistory.mockResolvedValue([]);

      const result = await useHistoryStore.getState().createSnapshotIfChanged({
        projectId: 'project-1',
        description: 'auto snapshot',
        blocks: blockFixture,
      });

      expect(result).toBe('snapshot-fallback');
    });
  });
});
