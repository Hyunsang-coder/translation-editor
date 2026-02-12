import type { EditorBlock, HistorySnapshot, HistorySnapshotMeta } from '@/types';
import { invoke } from '@/tauri/invoke';

export async function createSnapshot(params: {
  projectId: string;
  description: string;
  blocksJson: string;
  chatSummary?: string;
}): Promise<string> {
  return await invoke<string>('create_snapshot', {
    args: {
      projectId: params.projectId,
      description: params.description,
      blocksJson: params.blocksJson,
      chatSummary: params.chatSummary,
    },
  });
}

export async function listHistory(projectId: string): Promise<HistorySnapshotMeta[]> {
  return await invoke<HistorySnapshotMeta[]>('list_history', {
    args: { projectId },
  });
}

export async function getSnapshot(params: {
  projectId: string;
  snapshotId: string;
}): Promise<HistorySnapshot> {
  return await invoke<HistorySnapshot>('get_snapshot', {
    args: {
      projectId: params.projectId,
      snapshotId: params.snapshotId,
    },
  });
}

export async function restoreSnapshot(params: {
  projectId: string;
  snapshotId: string;
}): Promise<Record<string, EditorBlock>> {
  return await invoke<Record<string, EditorBlock>>('restore_snapshot', {
    args: {
      projectId: params.projectId,
      snapshotId: params.snapshotId,
    },
  });
}

export async function deleteSnapshot(params: {
  projectId: string;
  snapshotId: string;
}): Promise<void> {
  await invoke<void>('delete_snapshot', {
    args: {
      projectId: params.projectId,
      snapshotId: params.snapshotId,
    },
  });
}
