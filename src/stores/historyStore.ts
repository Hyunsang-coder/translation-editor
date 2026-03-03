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

type AutoSnapshotStatus = 'idle' | 'saving' | 'saved';

interface HistoryState {
  snapshots: HistorySnapshotMeta[];
  isLoading: boolean;
  isLoadingSnapshot: boolean;
  error: string | null;
  latestBlocksHash: string | null;
  autoSnapshotStatus: AutoSnapshotStatus;
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
  isLoading: false,
  isLoadingSnapshot: false,
  error: null,
  latestBlocksHash: null,
  autoSnapshotStatus: 'idle',
};

let loadHistoryRequestSeq = 0;
let autoSnapshotTimer: number | null = null;
let autoSnapshotSavedTimer: number | null = null;
let autoSnapshotInFlight = false;
let createSnapshotIfChangedInFlight = false;
// stopAutoSnapshotWatch 호출 후 in-flight Promise가 다른 프로젝트 state를 오염시키지
// 않도록, 실행 시점의 projectId를 캡처해 완료 시 검증한다.
let autoSnapshotActiveProjectId: string | null = null;
const AUTO_SNAPSHOT_DEBOUNCE_MS = 3000;

function isLatestRequest(requestSeq: number): boolean {
  return requestSeq === loadHistoryRequestSeq;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  ...initialState,

  loadHistory: async (projectId): Promise<void> => {
    const requestSeq = ++loadHistoryRequestSeq;
    if (!projectId) {
      if (!isLatestRequest(requestSeq)) return;
      set({ snapshots: [], isLoading: false, error: null, latestBlocksHash: null });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const snapshots = await tauriListHistory(projectId);
      if (!isLatestRequest(requestSeq)) return;
      set({ snapshots, isLoading: false });

      // Pre-compute latest snapshot hash in background
      if (snapshots.length > 0) {
        const latest = [...snapshots].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (latest) {
          tauriGetSnapshot({ projectId, snapshotId: latest.id })
            .then((s) => {
              if (s.snapshotJson && isLatestRequest(requestSeq)) {
                set({ latestBlocksHash: hashContent(s.snapshotJson) });
              }
            })
            .catch(() => {});
        }
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
      set({ latestBlocksHash: hashContent(blocksJson) });
    }

    try {
      const snapshots = await tauriListHistory(projectId);
      if (!isLatestRequest(requestSeq)) return snapshotId;
      set({ snapshots });
    } catch (error) {
      if (!isLatestRequest(requestSeq)) return snapshotId;
      console.warn('[history] snapshot created but list refresh failed:', error);
    }

    return snapshotId;
  },

  createSnapshotIfChanged: async ({ projectId, description, blocks, chatSummary }): Promise<string | null> => {
    if (createSnapshotIfChangedInFlight) return null;
    createSnapshotIfChangedInFlight = true;
    try {
      const { latestBlocksHash, snapshots, getSnapshot, createSnapshot } = get();
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
    } finally {
      createSnapshotIfChangedInFlight = false;
    }
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
      set({ snapshots });
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
    loadHistoryRequestSeq += 1;
    // latestBlocksHash는 유지 — null로 리셋하면 히스토리 창 재오픈 시
    // hash 재계산 전 autoSnapshot tick이 불필요한 저장을 유발함
    set({ ...initialState, latestBlocksHash: get().latestBlocksHash });
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

      const idleFor = Date.now() - lastChangeAt;
      const canSnapshot = idleFor >= AUTO_SNAPSHOT_DEBOUNCE_MS;

      if (canSnapshot && !autoSnapshotInFlight) {
        const blocks = materializeBlocksForSnapshot();
        if (blocks) {
          const { latestBlocksHash } = get();
          const currentHash = hashContent(JSON.stringify(blocks));

          if (latestBlocksHash === null) {
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
          set({ autoSnapshotStatus: 'saving' });
          const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const snapshotProjectId = project.id;
          void tauriUpsertAutoSnapshot({
            projectId: snapshotProjectId,
            blocksJson: JSON.stringify(blocks),
            description: `자동 저장 ${timeLabel}`,
          })
            .then(({ created }) => {
              // stopAutoSnapshotWatch 또는 프로젝트 전환으로 projectId가 달라진 경우 폐기
              if (autoSnapshotActiveProjectId !== snapshotProjectId) return;
              set({ latestBlocksHash: currentHash });
              // 새로 생성된 경우에만 목록 갱신
              if (created) {
                void tauriListHistory(snapshotProjectId)
                  .then((snapshots) => {
                    if (autoSnapshotActiveProjectId !== snapshotProjectId) return;
                    set({ snapshots });
                  })
                  .catch(() => {});
              } else {
                // 덮어쓴 경우 — description + timestamp 갱신 (재조회 없이)
                set((state) => ({
                  snapshots: state.snapshots.map((s) =>
                    s.description.startsWith('자동 저장')
                      ? { ...s, description: `자동 저장 ${timeLabel}`, timestamp: Date.now() }
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
              set({ autoSnapshotStatus: 'saved' });
              if (autoSnapshotSavedTimer !== null) window.clearTimeout(autoSnapshotSavedTimer);
              autoSnapshotSavedTimer = window.setTimeout(() => {
                set({ autoSnapshotStatus: 'idle' });
                autoSnapshotSavedTimer = null;
              }, 2000);
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
    if (autoSnapshotSavedTimer !== null) {
      window.clearTimeout(autoSnapshotSavedTimer);
      autoSnapshotSavedTimer = null;
    }
    autoSnapshotInFlight = false;
    // in-flight Promise의 projectId guard를 무효화하여 완료 콜백이 state를 오염시키지 않도록 한다.
    autoSnapshotActiveProjectId = null;
    set({ autoSnapshotStatus: 'idle' });
  },
}));
