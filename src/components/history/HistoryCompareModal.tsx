import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { VisualDiffViewer } from '@/components/ui/VisualDiffViewer';
import { useHistoryStore } from '@/stores/historyStore';
import { useProjectStore } from '@/stores/projectStore';
import { buildTargetDocument } from '@/editor/targetDocument';
import { stripHtml } from '@/utils/hash';
import type { EditorBlock } from '@/types';

interface HistoryCompareModalProps {
  open: boolean;
  projectId: string;
  snapshotId: string | null;
  onClose: () => void;
}

export function HistoryCompareModal({
  open,
  projectId,
  snapshotId,
  onClose,
}: HistoryCompareModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const getSnapshot = useHistoryStore((s) => s.getSnapshot);
  const [snapshotBlocks, setSnapshotBlocks] = useState<Record<string, EditorBlock> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !snapshotId) return;
    let cancelled = false;

    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await getSnapshot({ projectId, snapshotId });
        if (!snapshot.snapshotJson) {
          throw new Error('snapshotJson is empty');
        }
        const parsed = JSON.parse(snapshot.snapshotJson) as Record<string, EditorBlock>;
        if (!cancelled) {
          setSnapshotBlocks(parsed);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load snapshot');
          setSnapshotBlocks(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, snapshotId, projectId, getSnapshot]);

  const snapshotText = useMemo(() => {
    if (!project || !snapshotBlocks) return '';
    const snapshotProject = { ...project, blocks: snapshotBlocks };
    return stripHtml(buildTargetDocument(snapshotProject).text);
  }, [project, snapshotBlocks]);

  const currentText = useMemo(() => {
    if (!project) return '';
    return stripHtml(buildTargetDocument(project).text);
  }, [project]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} labelId="history-compare-title" className="!z-[80] bg-black/45 p-4">
      <div className="w-full max-w-6xl h-[85vh] bg-editor-bg border border-editor-border rounded-lg overflow-hidden flex flex-col">
        <div className="h-12 px-4 border-b border-editor-border flex items-center justify-between bg-editor-surface">
          <h3 id="history-compare-title" className="text-sm font-semibold text-editor-text">
            {t('history.compareTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
          >
            {t('common.close')}
          </button>
        </div>

        <div className="flex-1 p-4 min-h-0">
          {loading && (
            <div className="text-sm text-editor-muted">{t('history.loading')}</div>
          )}
          {!loading && error && (
            <div className="text-sm text-red-500">{error}</div>
          )}
          {!loading && !error && (
            <VisualDiffViewer original={snapshotText} suggested={currentText} />
          )}
        </div>
      </div>
    </Modal>
  );
}
