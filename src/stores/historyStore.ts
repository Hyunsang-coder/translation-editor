import { create } from 'zustand';
import type { EditorBlock, HistorySnapshot, HistorySnapshotMeta } from '@/types';
import {
  createSnapshot as tauriCreateSnapshot,
  deleteSnapshot as tauriDeleteSnapshot,
  getSnapshot as tauriGetSnapshot,
  listHistory as tauriListHistory,
  renameSnapshot as tauriRenameSnapshot,
} from '@/tauri/history';

interface HistoryState {
  snapshots: HistorySnapshotMeta[];
  isLoading: boolean;
  isLoadingSnapshot: boolean;
  error: string | null;
}

interface HistoryActions {
  loadHistory: (projectId: string) => Promise<void>;
  createSnapshot: (params: {
    projectId: string;
    description: string;
    blocks: Record<string, EditorBlock>;
    chatSummary?: string;
  }) => Promise<string>;
  getSnapshot: (params: { projectId: string; snapshotId: string }) => Promise<HistorySnapshot>;
  deleteSnapshot: (params: { projectId: string; snapshotId: string }) => Promise<void>;
  renameSnapshot: (params: { projectId: string; snapshotId: string; description: string }) => Promise<void>;
  reset: () => void;
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
};

let loadHistoryRequestSeq = 0;

export const useHistoryStore = create<HistoryStore>((set) => ({
  ...initialState,

  loadHistory: async (projectId): Promise<void> => {
    const requestSeq = ++loadHistoryRequestSeq;
    if (!projectId) {
      if (requestSeq !== loadHistoryRequestSeq) return;
      set({ snapshots: [], isLoading: false, error: null });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const snapshots = await tauriListHistory(projectId);
      if (requestSeq !== loadHistoryRequestSeq) return;
      set({ snapshots, isLoading: false });
    } catch (error) {
      if (requestSeq !== loadHistoryRequestSeq) return;
      const message = toErrorMessage(error);
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  createSnapshot: async ({ projectId, description, blocks, chatSummary }): Promise<string> => {
    set({ error: null });
    let snapshotId = '';
    try {
      snapshotId = await tauriCreateSnapshot({
        projectId,
        description,
        blocksJson: JSON.stringify(blocks),
        chatSummary,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      throw error;
    }

    try {
      const snapshots = await tauriListHistory(projectId);
      set({ snapshots });
    } catch (error) {
      console.warn('[history] snapshot created but list refresh failed:', error);
    }

    return snapshotId;
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
    set({ error: null });
    try {
      await tauriDeleteSnapshot({ projectId, snapshotId });
      const snapshots = await tauriListHistory(projectId);
      set({ snapshots });
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      throw error;
    }
  },

  renameSnapshot: async ({ projectId, snapshotId, description }): Promise<void> => {
    set({ error: null });
    try {
      await tauriRenameSnapshot({ projectId, snapshotId, description });
      set((state) => ({
        snapshots: state.snapshots.map((snapshot) =>
          snapshot.id === snapshotId ? { ...snapshot, description } : snapshot,
        ),
      }));
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      throw error;
    }
  },

  reset: (): void => {
    loadHistoryRequestSeq += 1;
    set(initialState);
  },
}));
