import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { restoreSnapshot as tauriRestoreSnapshot } from '@/tauri/history';
import { useHistoryStore } from '@/stores/historyStore';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';

interface HistoryRestoreDialogProps {
  open: boolean;
  projectId: string;
  snapshotId: string | null;
  onClose: () => void;
}

export function HistoryRestoreDialog({
  open,
  projectId,
  snapshotId,
  onClose,
}: HistoryRestoreDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const [isRestoring, setIsRestoring] = useState(false);
  const project = useProjectStore((s) => s.project);
  const materializeBlocksForSnapshot = useProjectStore((s) => s.materializeBlocksForSnapshot);
  const loadProject = useProjectStore((s) => s.loadProject);
  const saveProject = useProjectStore((s) => s.saveProject);
  const createSnapshotIfChanged = useHistoryStore((s) => s.createSnapshotIfChanged);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const sourceEditor = useEditorStore((s) => s.sourceEditor);
  const targetEditor = useEditorStore((s) => s.targetEditor);
  const addToast = useUIStore((s) => s.addToast);

  if (!open) return null;

  const handleRestore = async (): Promise<void> => {
    if (!project || !snapshotId) return;

    setIsRestoring(true);
    try {
      try {
        const blocksForSnapshot = materializeBlocksForSnapshot();
        if (!blocksForSnapshot) {
          throw new Error('Project blocks are unavailable for snapshot');
        }
        const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await createSnapshotIfChanged({
          projectId,
          description: `${t('history.autoSnapshotBeforeRestore')} ${timeLabel}`,
          blocks: blocksForSnapshot,
        });
      } catch (e) {
        console.warn('[history] auto snapshot before restore failed:', e);
      }

      const restoredBlocks = await tauriRestoreSnapshot({ projectId, snapshotId });
      const restoredProject = {
        ...project,
        blocks: restoredBlocks,
        metadata: {
          ...project.metadata,
          updatedAt: Date.now(),
        },
      };

      loadProject(restoredProject, { hydrateComments: false });

      const sourceDoc = buildSourceDocument(restoredProject).text;
      const targetDoc = buildTargetDocument(restoredProject).text;

      if (sourceEditor) {
        replaceDocContent(sourceEditor, sourceDoc, { addToHistory: false });
      }
      if (targetEditor) {
        replaceDocContent(targetEditor, targetDoc, { addToHistory: false });
      }

      await saveProject();
      await loadHistory(projectId);

      addToast({
        type: 'success',
        message: t('history.restoreSuccess'),
      });
      onClose();
    } catch (e) {
      addToast({
        type: 'error',
        message:
          e instanceof Error
            ? e.message
            : t('history.restoreError'),
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelId="history-restore-title" className="bg-black/40 p-4">
      <div className="w-full max-w-md bg-editor-surface border border-editor-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-editor-border">
          <h3 id="history-restore-title" className="text-sm font-semibold text-editor-text">
            {t('history.restoreConfirmTitle')}
          </h3>
        </div>
        <div className="p-4 text-sm text-editor-text">
          {t('history.restoreConfirmDescription')}
        </div>
        <div className="px-4 py-3 border-t border-editor-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isRestoring}
            className="px-3 py-1.5 text-sm rounded border border-editor-border text-editor-text hover:bg-editor-bg disabled:opacity-60 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={isRestoring}
            className="px-3 py-1.5 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
          >
            {isRestoring ? t('common.loading') : t('history.restore')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
