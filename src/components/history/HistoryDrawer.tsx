import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HistoryTimeline } from '@/components/history/HistoryTimeline';
import { SaveSnapshotDialog } from '@/components/history/SaveSnapshotDialog';
import { HistoryCompareModal } from '@/components/history/HistoryCompareModal';
import { HistoryRestoreDialog } from '@/components/history/HistoryRestoreDialog';
import { useProjectStore } from '@/stores/projectStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUIStore } from '@/stores/uiStore';

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function HistoryDrawer({ open, onClose }: HistoryDrawerProps): JSX.Element | null {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const addToast = useUIStore((s) => s.addToast);

  const snapshots = useHistoryStore((s) => s.snapshots);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const createSnapshot = useHistoryStore((s) => s.createSnapshot);
  const deleteSnapshot = useHistoryStore((s) => s.deleteSnapshot);
  const reset = useHistoryStore((s) => s.reset);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    setCompareOpen(false);
    setRestoreOpen(false);
    setSelectedSnapshotId(null);
  }, [projectId, reset]);

  const selectedDescription = useMemo(() => {
    if (!selectedSnapshotId) return '';
    return snapshots.find((s) => s.id === selectedSnapshotId)?.description ?? '';
  }, [selectedSnapshotId, snapshots]);

  if (!open || !project) return null;

  const handleManualSave = async (description: string): Promise<void> => {
    setIsSaving(true);
    try {
      await createSnapshot({
        projectId,
        description: description || t('history.defaultManualDescription'),
        blocks: project.blocks,
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
    const ok = window.confirm(t('history.deleteConfirm'));
    if (!ok) return;

    try {
      await deleteSnapshot({ projectId, snapshotId });
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />

      <aside className="fixed top-0 right-0 h-full w-96 z-50 bg-editor-surface border-l border-editor-border shadow-2xl flex flex-col">
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

        <div className="p-4 border-b border-editor-border">
          <button
            type="button"
            onClick={() => setSaveDialogOpen(true)}
            className="w-full px-3 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
          >
            {t('history.saveSnapshot')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <HistoryTimeline
            snapshots={snapshots}
            isLoading={isLoading}
            onCompare={(snapshotId) => {
              setSelectedSnapshotId(snapshotId);
              setCompareOpen(true);
            }}
            onRestore={(snapshotId) => {
              setSelectedSnapshotId(snapshotId);
              setRestoreOpen(true);
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

      <HistoryCompareModal
        open={compareOpen}
        projectId={projectId}
        snapshotId={selectedSnapshotId}
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
