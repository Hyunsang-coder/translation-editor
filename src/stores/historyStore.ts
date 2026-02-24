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

interface HistoryState {
  snapshots: HistorySnapshotMeta[];
  isLoading: boolean;
  isLoadingSnapshot: boolean;
  error: string | null;
  latestBlocksHash: string | null;
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
};

let loadHistoryRequestSeq = 0;
let autoSnapshotTimer: number | null = null;
let autoSnapshotInFlight = false;
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

    // Update hash cache after successful creation
    set({ latestBlocksHash: hashContent(blocksJson) });

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
    set(initialState);
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

          if (latestBlocksHash !== null && currentHash === latestBlocksHash) {
            // No change — skip
            autoSnapshotTimer = window.setTimeout(tick, 500);
            return;
          }

          autoSnapshotInFlight = true;
          void tauriUpsertAutoSnapshot({
            projectId: project.id,
            blocksJson: JSON.stringify(blocks),
          })
            .then(({ created }) => {
              set({ latestBlocksHash: currentHash });
              // 새로 생성된 경우에만 목록 갱신
              if (created) {
                void tauriListHistory(project.id)
                  .then((snapshots) => set({ snapshots }))
                  .catch(() => {});
              } else {
                // 덮어쓴 경우 — 목록의 timestamp만 갱신 (재조회 없이)
                set((state) => ({
                  snapshots: state.snapshots.map((s) =>
                    s.description === 'autoSnapshot'
                      ? { ...s, timestamp: Date.now() }
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
  },
}));
