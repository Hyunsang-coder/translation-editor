import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirm } from '@tauri-apps/plugin-dialog';
import { HistoryTimeline, CURRENT_STATE_ID } from '@/components/history/HistoryTimeline';
import { SaveSnapshotDialog } from '@/components/history/SaveSnapshotDialog';
import { HistoryRenameDialog } from '@/components/history/HistoryRenameDialog';
import { HistoryCompareModal } from '@/components/history/HistoryCompareModal';
import { HistoryRestoreDialog } from '@/components/history/HistoryRestoreDialog';
import { useProjectStore } from '@/stores/projectStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUIStore } from '@/stores/uiStore';
import { hashContent } from '@/utils/hash';

function isTauriTestingBridgeActive(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_TESTING_BRIDGE__?: unknown };
  return typeof w.__TAURI_TESTING_BRIDGE__ === 'object' && w.__TAURI_TESTING_BRIDGE__ !== null;
}

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function HistoryDrawer({ open, onClose }: HistoryDrawerProps): JSX.Element | null {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const materializeBlocksForSnapshot = useProjectStore((s) => s.materializeBlocksForSnapshot);
  const lastChangeAt = useProjectStore((s) => s.lastChangeAt);
  const addToast = useUIStore((s) => s.addToast);

  const snapshots = useHistoryStore((s) => s.snapshots);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const latestBlocksHash = useHistoryStore((s) => s.latestBlocksHash);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const createSnapshot = useHistoryStore((s) => s.createSnapshot);
  const deleteSnapshot = useHistoryStore((s) => s.deleteSnapshot);
  const renameSnapshot = useHistoryStore((s) => s.renameSnapshot);
  const reset = useHistoryStore((s) => s.reset);

  const autoSnapshotTimestamp = useMemo(() => {
    const auto = snapshots.find((s) => s.description === 'autoSnapshot' || s.description.startsWith('자동 저장'));
    return auto?.timestamp ?? null;
  }, [snapshots]);

  const visibleSnapshots = useMemo(
    () => snapshots.filter((s) => s.description !== 'autoSnapshot' && !s.description.startsWith('자동 저장')),
    [snapshots],
  );

  const currentBlocksHash = useMemo(() => {
    const blocks = materializeBlocksForSnapshot();
    if (!blocks) return null;
    return hashContent(JSON.stringify(blocks));
  }, [materializeBlocksForSnapshot, lastChangeAt]);

  const isCurrentModified =
    latestBlocksHash !== null &&
    currentBlocksHash !== null &&
    currentBlocksHash !== latestBlocksHash;

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renamingSnapshotId, setRenamingSnapshotId] = useState<string | null>(null);

  // Checkbox selection state (max 2), default: current state checked
  const [selectedIds, setSelectedIds] = useState<string[]>([CURRENT_STATE_ID]);

  // Compare modal initial target snapshot
  const [compareInitialTargetId, setCompareInitialTargetId] = useState<string | undefined>(undefined);

  const projectId = project?.id ?? '';

  useEffect(() => {
    if (!open || !projectId) return;
    void loadHistory(projectId).catch((e) => {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('history.loadError'),
      });
    });
  }, [open, projectId, loadHistory, addToast, t]);

  useEffect(() => {
    reset();
    setRenameDialogOpen(false);
    setRenamingSnapshotId(null);
    setCompareOpen(false);
    setRestoreOpen(false);
    setSelectedSnapshotId(null);
    setSelectedIds([CURRENT_STATE_ID]);
  }, [projectId, reset]);

  const selectedDescription = useMemo(() => {
    if (!selectedSnapshotId) return '';
    return snapshots.find((s) => s.id === selectedSnapshotId)?.description ?? '';
  }, [selectedSnapshotId, snapshots]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }, []);

  const handleCompareSelected = useCallback(() => {
    if (selectedIds.length !== 2) return;

    const includesCurrent = selectedIds.includes(CURRENT_STATE_ID);

    if (includesCurrent) {
      // The non-current ID is the base snapshot
      const snapshotId = selectedIds.find((id) => id !== CURRENT_STATE_ID)!;
      setSelectedSnapshotId(snapshotId);
      setCompareInitialTargetId(undefined); // compare with current
    } else {
      // Sort by timestamp: older = base, newer = target
      const sorted = [...selectedIds].sort((a, b) => {
        const tsA = snapshots.find((s) => s.id === a)?.timestamp ?? 0;
        const tsB = snapshots.find((s) => s.id === b)?.timestamp ?? 0;
        return tsA - tsB;
      });
      setSelectedSnapshotId(sorted[0] ?? null);
      setCompareInitialTargetId(sorted[1]);
    }
    setCompareOpen(true);
  }, [selectedIds, snapshots]);

  if (!open || !project) return null;

  const handleManualSave = async (description: string): Promise<void> => {
    setIsSaving(true);
    try {
      const blocksForSnapshot = materializeBlocksForSnapshot();
      if (!blocksForSnapshot) {
        throw new Error('Project blocks are unavailable for snapshot');
      }
      await createSnapshot({
        projectId,
        description: description || t('history.defaultManualDescription'),
        blocks: blocksForSnapshot,
      });
      addToast({
        type: 'success',
        message: t('history.saveSuccess'),
      });
      setSaveDialogOpen(false);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('history.saveError'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (snapshotId: string): Promise<void> => {
    const ok = isTauriTestingBridgeActive()
      ? true
      : await confirm(t('history.deleteConfirm'), {
          title: t('history.delete'),
          kind: 'warning',
        });
    if (!ok) return;

    try {
      await deleteSnapshot({ projectId, snapshotId });
      // Remove from selection if it was selected
      setSelectedIds((prev) => prev.filter((id) => id !== snapshotId));
      addToast({
        type: 'success',
        message: t('history.deleteSuccess'),
      });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('history.deleteError'),
      });
    }
  };

  const handleRename = async (snapshotId: string): Promise<void> => {
    const snapshot = snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return;
    setRenamingSnapshotId(snapshot.id);
    setRenameDialogOpen(true);
  };

  const handleRenameSubmit = async (description: string): Promise<void> => {
    if (!renamingSnapshotId) return;
    const snapshot = snapshots.find((item) => item.id === renamingSnapshotId);
    if (!snapshot) return;
    if (description === snapshot.description) {
      setRenameDialogOpen(false);
      setRenamingSnapshotId(null);
      return;
    }

    setIsRenaming(true);
    try {
      await renameSnapshot({
        projectId,
        snapshotId: renamingSnapshotId,
        description,
      });
      addToast({
        type: 'success',
        message: t('history.renameSuccess'),
      });
      setRenameDialogOpen(false);
      setRenamingSnapshotId(null);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('history.renameError'),
      });
    } finally {
      setIsRenaming(false);
    }
  };

  const canCompare = selectedIds.length === 2;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />

      <aside className="fixed top-0 right-0 h-full w-96 z-50 bg-editor-surface border-l border-editor-border shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="h-14 px-4 border-b border-editor-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-editor-text">{t('history.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
          >
            {t('common.close')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <HistoryTimeline
            snapshots={visibleSnapshots}
            isLoading={isLoading}
            isCurrentModified={isCurrentModified}
            autoSnapshotTimestamp={autoSnapshotTimestamp}
            selectedIds={selectedIds}
            canCompare={canCompare}
            onToggleSelect={handleToggleSelect}
            onCompare={handleCompareSelected}
            onClearSelection={() => setSelectedIds([])}
            onSave={() => setSaveDialogOpen(true)}
            onRestore={(snapshotId) => {
              setSelectedSnapshotId(snapshotId);
              setRestoreOpen(true);
            }}
            onRename={(snapshotId) => {
              void handleRename(snapshotId);
            }}
            onDelete={(snapshotId) => {
              void handleDelete(snapshotId);
            }}
          />
        </div>
      </aside>

      <SaveSnapshotDialog
        open={saveDialogOpen}
        isSaving={isSaving}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleManualSave}
      />

      <HistoryRenameDialog
        open={renameDialogOpen}
        initialDescription={renamingSnapshotId ? snapshots.find((item) => item.id === renamingSnapshotId)?.description ?? '' : ''}
        isSaving={isRenaming}
        onClose={() => {
          if (isRenaming) return;
          setRenameDialogOpen(false);
          setRenamingSnapshotId(null);
        }}
        onRename={handleRenameSubmit}
      />

      <HistoryCompareModal
        open={compareOpen}
        projectId={projectId}
        snapshotId={selectedSnapshotId}
        snapshots={visibleSnapshots}
        initialTargetSnapshotId={compareInitialTargetId}
        onClose={() => setCompareOpen(false)}
      />

      <HistoryRestoreDialog
        open={restoreOpen}
        projectId={projectId}
        snapshotId={selectedSnapshotId}
        onClose={() => setRestoreOpen(false)}
      />

      {selectedDescription && (
        <span className="sr-only">{selectedDescription}</span>
      )}
    </>
  );
}
