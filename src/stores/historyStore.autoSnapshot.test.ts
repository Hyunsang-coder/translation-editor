import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBlock } from '@/types';

const tauriHistoryMock = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  getSnapshot: vi.fn(),
  listHistory: vi.fn(),
  renameSnapshot: vi.fn(),
  upsertAutoSnapshot: vi.fn(),
}));
vi.mock('@/tauri/history', () => tauriHistoryMock);

// historyStore가 tick마다 useProjectStore.getState()를 읽으므로 최소 형태로 대체한다.
const projectStateMock = vi.hoisted(() => ({
  current: {
    project: null as { id: string } | null,
    lastChangeAt: 0,
    materializeBlocksForSnapshot: (): Record<string, EditorBlock> | null => null,
  },
}));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => projectStateMock.current },
}));

import { useHistoryStore } from './historyStore';

const blocks: Record<string, EditorBlock> = {
  'target-1': {
    id: 'target-1',
    type: 'target',
    content: '<p>편집됨</p>',
    hash: 'hash-target-1',
    metadata: { createdAt: 1, updatedAt: 1, tags: [] },
  },
};

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 편집 직후(idle 충족) 상태의 projectStore를 흉내낸다. */
function setDirtyProject(projectId: string): void {
  projectStateMock.current = {
    project: { id: projectId },
    lastChangeAt: Date.now() - 10_000,
    materializeBlocksForSnapshot: () => blocks,
  };
}

/** loadHistory가 hash 캐시를 채운 상태를 흉내낸다. ''는 "스냅샷 없음" sentinel. */
function primeHash(projectId: string): void {
  useHistoryStore.setState({ latestBlocksHash: '', latestBlocksHashProjectId: projectId });
}

describe('startAutoSnapshotWatch 라이프사이클', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHistoryStore.getState().reset();
    vi.useFakeTimers();
    tauriHistoryMock.upsertAutoSnapshot.mockResolvedValue({ snapshotId: 'snap-1', created: true });
    tauriHistoryMock.listHistory.mockResolvedValue([]);
  });

  afterEach(() => {
    useHistoryStore.getState().stopAutoSnapshotWatch();
    vi.useRealTimers();
  });

  it('idle 조건을 만족하고 hash가 달라지면 upsert를 호출한다', async () => {
    primeHash('project-1');
    setDirtyProject('project-1');

    useHistoryStore.getState().startAutoSnapshotWatch();
    await vi.advanceTimersByTimeAsync(600);

    expect(tauriHistoryMock.upsertAutoSnapshot).toHaveBeenCalledTimes(1);
    expect(tauriHistoryMock.upsertAutoSnapshot.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1',
    });
  });

  it('reset(프로젝트 전환) 이후에도 watch가 계속 동작한다', async () => {
    primeHash('project-1');
    projectStateMock.current = {
      project: { id: 'project-1' },
      lastChangeAt: 0,
      materializeBlocksForSnapshot: () => blocks,
    };

    useHistoryStore.getState().startAutoSnapshotWatch();
    await vi.advanceTimersByTimeAsync(600);
    expect(tauriHistoryMock.upsertAutoSnapshot).not.toHaveBeenCalled();

    // 프로젝트 전환: switchProjectById가 historyStore.reset()을 호출한다
    useHistoryStore.getState().reset();

    // 새 프로젝트 로드 → loadHistory가 hash를 채우고, 사용자가 편집
    primeHash('project-2');
    setDirtyProject('project-2');

    await vi.advanceTimersByTimeAsync(600);

    expect(tauriHistoryMock.upsertAutoSnapshot).toHaveBeenCalledTimes(1);
    expect(tauriHistoryMock.upsertAutoSnapshot.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-2',
    });
  });

  it('stopAutoSnapshotWatch 이후에는 더 이상 동작하지 않는다', async () => {
    primeHash('project-1');
    setDirtyProject('project-1');

    useHistoryStore.getState().startAutoSnapshotWatch();
    useHistoryStore.getState().stopAutoSnapshotWatch();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(tauriHistoryMock.upsertAutoSnapshot).not.toHaveBeenCalled();
  });

  it('덮어쓰기 후 목록 갱신은 kind로 auto 슬롯만 고른다 (description 매칭 금지)', async () => {
    tauriHistoryMock.upsertAutoSnapshot.mockResolvedValue({ snapshotId: 'auto-1', created: false });

    // 사용자가 수동 스냅샷 이름을 자동 저장처럼 바꿔둔 상태
    useHistoryStore.setState({
      snapshots: [
        { id: 'auto-1', timestamp: 100, description: '자동 저장 09:00', kind: 'auto' },
        { id: 'manual-1', timestamp: 90, description: '자동 저장 백업', kind: 'manual' },
      ],
      snapshotsProjectId: 'project-1',
      latestBlocksHash: '',
      latestBlocksHashProjectId: 'project-1',
    });
    setDirtyProject('project-1');

    useHistoryStore.getState().startAutoSnapshotWatch();
    await vi.advanceTimersByTimeAsync(600);

    const updated = useHistoryStore.getState().snapshots;
    expect(updated.find((s) => s.id === 'auto-1')?.description).not.toBe('자동 저장 09:00');
    expect(updated.find((s) => s.id === 'manual-1')).toEqual({
      id: 'manual-1',
      timestamp: 90,
      description: '자동 저장 백업',
      kind: 'manual',
    });
  });

  it('전환 중 완료된 이전 프로젝트의 upsert는 새 프로젝트 state를 덮지 않는다', async () => {
    const deferred = createDeferred<{ snapshotId: string; created: boolean }>();
    tauriHistoryMock.upsertAutoSnapshot.mockReturnValue(deferred.promise);

    primeHash('project-1');
    setDirtyProject('project-1');

    useHistoryStore.getState().startAutoSnapshotWatch();
    await vi.advanceTimersByTimeAsync(600);
    expect(tauriHistoryMock.upsertAutoSnapshot).toHaveBeenCalledTimes(1);

    // upsert가 아직 in-flight인 상태에서 프로젝트 전환
    useHistoryStore.getState().reset();
    primeHash('project-2');

    deferred.resolve({ snapshotId: 'snap-1', created: true });
    await vi.advanceTimersByTimeAsync(0);

    // project-1의 완료 콜백이 project-2의 hash 캐시를 오염시키면 안 된다
    expect(useHistoryStore.getState().latestBlocksHashProjectId).toBe('project-2');
    expect(useHistoryStore.getState().latestBlocksHash).toBe('');
  });
});
