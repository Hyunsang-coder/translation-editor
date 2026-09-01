import { create } from 'zustand';
import type { EditorBlock, HistorySnapshot, HistorySnapshotMeta } from '@/types';
import {
  createSnapshot as tauriCreateSnapshot,
  deleteSnapshot as tauriDeleteSnapshot,
  getSnapshot as tauriGetSnapshot,
  listHistory as tauriListHistory,
  renameSnapshot as tauriRenameSnapshot,
  upsertAutoSnapshot as tauriUpsertAutoSnapshot,
} from '@/tauri/history';
import { hashContent } from '@/utils/hash';
import { useProjectStore } from '@/stores/projectStore';
import i18n from '@/i18n/config';
import { formatTimeOfDay } from '@/utils/datetime';

interface HistoryState {
  snapshots: HistorySnapshotMeta[];
  snapshotsProjectId: string | null;
  isLoading: boolean;
  isLoadingSnapshot: boolean;
  error: string | null;
  latestBlocksHash: string | null;
  latestBlocksHashProjectId: string | null;
}

interface HistoryActions {
  loadHistory: (projectId: string) => Promise<void>;
  createSnapshot: (params: {
    projectId: string;
    description: string;
    blocks: Record<string, EditorBlock>;
    chatSummary?: string;
  }) => Promise<string>;
  createSnapshotIfChanged: (params: {
    projectId: string;
    description: string;
    blocks: Record<string, EditorBlock>;
    chatSummary?: string;
  }) => Promise<string | null>;
  getSnapshot: (params: { projectId: string; snapshotId: string }) => Promise<HistorySnapshot>;
  deleteSnapshot: (params: { projectId: string; snapshotId: string }) => Promise<void>;
  renameSnapshot: (params: { projectId: string; snapshotId: string; description: string }) => Promise<void>;
  reset: () => void;
  startAutoSnapshotWatch: () => void;
  stopAutoSnapshotWatch: () => void;
}

type HistoryStore = HistoryState & HistoryActions;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'History operation failed';
}

const initialState: HistoryState = {
  snapshots: [],
  snapshotsProjectId: null,
  isLoading: false,
  isLoadingSnapshot: false,
  error: null,
  latestBlocksHash: null,
  latestBlocksHashProjectId: null,
};

let loadHistoryRequestSeq = 0;
let autoSnapshotTimer: number | null = null;
let autoSnapshotInFlight = false;
let lastCheckedChangeAt = 0;
const createSnapshotIfChangedQueues = new Map<string, Promise<string | null>>();
// stopAutoSnapshotWatch 호출 후 in-flight Promise가 다른 프로젝트 state를 오염시키지
// 않도록, 실행 시점의 projectId를 캡처해 완료 시 검증한다.
let autoSnapshotActiveProjectId: string | null = null;
const AUTO_SNAPSHOT_DEBOUNCE_MS = 3000;

function isLatestRequest(requestSeq: number): boolean {
  return requestSeq === loadHistoryRequestSeq;
}

function getProjectScopedHash(state: HistoryState, projectId: string): string | null {
  return state.latestBlocksHashProjectId === null || state.latestBlocksHashProjectId === projectId
    ? state.latestBlocksHash
    : null;
}

function getProjectScopedSnapshots(
  state: HistoryState,
  projectId: string,
): HistorySnapshotMeta[] {
  return state.snapshotsProjectId === null || state.snapshotsProjectId === projectId
    ? state.snapshots
    : [];
}

function enqueueSnapshotIfChanged(
  projectId: string,
  task: () => Promise<string | null>,
): Promise<string | null> {
  const previous = createSnapshotIfChangedQueues.get(projectId) ?? Promise.resolve(null);
  const queued = previous.catch(() => null).then(task);
  const cleanup = queued.finally(() => {
    if (createSnapshotIfChangedQueues.get(projectId) === cleanup) {
      createSnapshotIfChangedQueues.delete(projectId);
    }
  });
  createSnapshotIfChangedQueues.set(projectId, cleanup);
  return cleanup;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  ...initialState,

  loadHistory: async (projectId): Promise<void> => {
    const requestSeq = ++loadHistoryRequestSeq;
    if (!projectId) {
      if (!isLatestRequest(requestSeq)) return;
      set({
        snapshots: [],
        snapshotsProjectId: null,
        isLoading: false,
        error: null,
        latestBlocksHash: null,
        latestBlocksHashProjectId: null,
      });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const snapshots = await tauriListHistory(projectId);
      if (!isLatestRequest(requestSeq)) return;
      set({
        snapshots,
        snapshotsProjectId: projectId,
        isLoading: false,
        latestBlocksHash: snapshots.length > 0 ? null : '',
        latestBlocksHashProjectId: projectId,
      });

      // Pre-compute latest snapshot hash in background
      if (snapshots.length > 0) {
        const latest = [...snapshots].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (latest) {
          tauriGetSnapshot({ projectId, snapshotId: latest.id })
            .then((s) => {
              if (s.snapshotJson && isLatestRequest(requestSeq)) {
                set({
                  latestBlocksHash: hashContent(s.snapshotJson),
                  latestBlocksHashProjectId: projectId,
                });
              }
            })
            .catch(() => {
              if (!isLatestRequest(requestSeq)) return;
              set({ latestBlocksHash: '', latestBlocksHashProjectId: projectId });
            });
        }
      } else {
        // 스냅샷이 없는 신규 프로젝트 — 빈 sentinel로 초기화해서 auto snapshot이 진행되도록 함
        set({ latestBlocksHash: '', latestBlocksHashProjectId: projectId });
      }
    } catch (error) {
      if (!isLatestRequest(requestSeq)) return;
      const message = toErrorMessage(error);
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  createSnapshot: async ({ projectId, description, blocks, chatSummary }): Promise<string> => {
    const requestSeq = loadHistoryRequestSeq;
    set({ error: null });
    const blocksJson = JSON.stringify(blocks);
    let snapshotId = '';
    try {
      snapshotId = await tauriCreateSnapshot({
        projectId,
        description,
        blocksJson,
        ...(chatSummary !== undefined && { chatSummary }),
      });
    } catch (error) {
      if (!isLatestRequest(requestSeq)) throw error;
      const message = toErrorMessage(error);
      set({ error: message });
      throw error;
    }

    // Update hash cache after successful creation — guard with requestSeq to
    // prevent stale project's hash from overwriting the current project's cache.
    if (isLatestRequest(requestSeq)) {
      set({
        latestBlocksHash: hashContent(blocksJson),
        latestBlocksHashProjectId: projectId,
      });
    }

    try {
      const snapshots = await tauriListHistory(projectId);
      if (!isLatestRequest(requestSeq)) return snapshotId;
      set({ snapshots, snapshotsProjectId: projectId });
    } catch (error) {
      if (!isLatestRequest(requestSeq)) return snapshotId;
      console.warn('[history] snapshot created but list refresh failed:', error);
    }

    return snapshotId;
  },

  createSnapshotIfChanged: async ({ projectId, description, blocks, chatSummary }): Promise<string | null> => {
    return enqueueSnapshotIfChanged(projectId, async () => {
      const state = get();
      const latestBlocksHash = getProjectScopedHash(state, projectId);
      const snapshots = getProjectScopedSnapshots(state, projectId);
      const { getSnapshot, createSnapshot } = state;
      const currentHash = hashContent(JSON.stringify(blocks));

      // Cached hash available — fast path comparison
      if (latestBlocksHash !== null && currentHash === latestBlocksHash) {
        return null; // No change → skip
      }

      // No cached hash (session first call) — load latest snapshot and compare
      if (latestBlocksHash === null && snapshots.length > 0) {
        const latest = [...snapshots].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (!latest) return await createSnapshot({ projectId, description, blocks, ...(chatSummary !== undefined ? { chatSummary } : {}) });
        try {
          const snapshot = await getSnapshot({ projectId, snapshotId: latest.id });
          if (snapshot.snapshotJson && hashContent(snapshot.snapshotJson) === currentHash) {
            set({ latestBlocksHash: currentHash });
            return null; // No change
          }
        } catch {
          // Load failed — proceed with snapshot creation
        }
      }

      return await createSnapshot({ projectId, description, blocks, ...(chatSummary !== undefined ? { chatSummary } : {}) });
    });
  },

  getSnapshot: async ({ projectId, snapshotId }): Promise<HistorySnapshot> => {
    set({ isLoadingSnapshot: true, error: null });
    try {
      const snapshot = await tauriGetSnapshot({ projectId, snapshotId });
      set({ isLoadingSnapshot: false });
      return snapshot;
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message, isLoadingSnapshot: false });
      throw error;
    }
  },

  deleteSnapshot: async ({ projectId, snapshotId }): Promise<void> => {
    const requestSeq = loadHistoryRequestSeq;
    set({ error: null });
    try {
      await tauriDeleteSnapshot({ projectId, snapshotId });
      const snapshots = await tauriListHistory(projectId);
      if (!isLatestRequest(requestSeq)) return;
      set({ snapshots, snapshotsProjectId: projectId });
    } catch (error) {
      if (!isLatestRequest(requestSeq)) throw error;
      const message = toErrorMessage(error);
      set({ error: message });
      throw error;
    }
  },

  renameSnapshot: async ({ projectId, snapshotId, description }): Promise<void> => {
    const requestSeq = loadHistoryRequestSeq;
    set({ error: null });
    try {
      await tauriRenameSnapshot({ projectId, snapshotId, description });
      if (!isLatestRequest(requestSeq)) return;
      set((state) => ({
        snapshots: state.snapshots.map((snapshot) =>
          snapshot.id === snapshotId ? { ...snapshot, description } : snapshot,
        ),
      }));
    } catch (error) {
      if (!isLatestRequest(requestSeq)) throw error;
      const message = toErrorMessage(error);
      set({ error: message });
      throw error;
    }
  },

  reset: (): void => {
    // 타이머는 라이프사이클(App mount/unmount)이 소유한다 — reset은 상태만 비운다.
    // 여기서 타이머를 끄면 startAutoSnapshotWatch가 App 마운트 시 한 번만 호출되므로
    // 프로젝트 전환 이후 auto snapshot이 세션 내내 멈춘다.
    // autoSnapshotInFlight도 건드리지 않는다 — in-flight Promise의 finally가 소유하며,
    // 여기서 미리 내리면 이전 요청이 끝나기 전에 다음 tick이 중복 upsert를 시작한다.
    lastCheckedChangeAt = 0;
    autoSnapshotActiveProjectId = null;
    createSnapshotIfChangedQueues.clear();

    loadHistoryRequestSeq += 1;
    set({ ...initialState });
  },

  startAutoSnapshotWatch: (): void => {
    if (autoSnapshotTimer !== null) return;

    const tick = (): void => {
      const projectState = useProjectStore.getState();
      const { project, lastChangeAt, materializeBlocksForSnapshot } = projectState;

      if (!project || !lastChangeAt) {
        autoSnapshotTimer = window.setTimeout(tick, 500);
        return;
      }

      // 이전 tick 이후 lastChangeAt이 변경되지 않았으면 hash 계산 불필요
      if (lastChangeAt === lastCheckedChangeAt) {
        autoSnapshotTimer = window.setTimeout(tick, 500);
        return;
      }

      const idleFor = Date.now() - lastChangeAt;
      const canSnapshot = idleFor >= AUTO_SNAPSHOT_DEBOUNCE_MS;

      if (canSnapshot && !autoSnapshotInFlight) {
        lastCheckedChangeAt = lastChangeAt;
        const blocks = materializeBlocksForSnapshot();
        if (blocks) {
          const { latestBlocksHash, latestBlocksHashProjectId } = get();
          const currentHash = hashContent(JSON.stringify(blocks));

          if (latestBlocksHashProjectId !== project.id || latestBlocksHash === null) {
            // Hash not yet initialized — wait for loadHistory to populate it,
            // then compare on next tick to avoid duplicate snapshots on session start.
            autoSnapshotTimer = window.setTimeout(tick, 500);
            return;
          }

          if (currentHash === latestBlocksHash) {
            // No change — skip
            autoSnapshotTimer = window.setTimeout(tick, 500);
            return;
          }

          autoSnapshotInFlight = true;
          autoSnapshotActiveProjectId = project.id;
          const timeLabel = formatTimeOfDay(Date.now());
          // description은 표시용일 뿐이다 — 자동 슬롯 판별은 백엔드의 kind 컬럼이 한다.
          const autoDescription = `${i18n.t('history.autoSnapshotLabel')} ${timeLabel}`;
          const snapshotProjectId = project.id;
          void tauriUpsertAutoSnapshot({
            projectId: snapshotProjectId,
            blocksJson: JSON.stringify(blocks),
            description: autoDescription,
          })
            .then(({ created }) => {
              // stopAutoSnapshotWatch 또는 프로젝트 전환으로 projectId가 달라진 경우 폐기
              if (autoSnapshotActiveProjectId !== snapshotProjectId) return;
              set({ latestBlocksHash: currentHash, latestBlocksHashProjectId: snapshotProjectId });
              // 새로 생성된 경우에만 목록 갱신
              if (created) {
                void tauriListHistory(snapshotProjectId)
                  .then((snapshots) => {
                    if (autoSnapshotActiveProjectId !== snapshotProjectId) return;
                    set({ snapshots, snapshotsProjectId: snapshotProjectId });
                  })
                  .catch(() => {});
              } else {
                // 덮어쓴 경우 — description + timestamp 갱신 (재조회 없이)
                set((state) => ({
                  snapshots: state.snapshots.map((s) =>
                    s.kind === 'auto'
                      ? { ...s, description: autoDescription, timestamp: Date.now() }
                      : s,
                  ),
                }));
              }
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              console.warn('[AutoSnapshot] Failed:', message);
            })
            .finally(() => {
              autoSnapshotInFlight = false;
            });
        }
      }

      autoSnapshotTimer = window.setTimeout(tick, 500);
    };

    autoSnapshotTimer = window.setTimeout(tick, 500);
  },

  stopAutoSnapshotWatch: (): void => {
    if (autoSnapshotTimer !== null) {
      window.clearTimeout(autoSnapshotTimer);
      autoSnapshotTimer = null;
    }
    autoSnapshotInFlight = false;
    lastCheckedChangeAt = 0;
    // in-flight Promise의 projectId guard를 무효화하여 완료 콜백이 state를 오염시키지 않도록 한다.
    autoSnapshotActiveProjectId = null;
  },
}));
