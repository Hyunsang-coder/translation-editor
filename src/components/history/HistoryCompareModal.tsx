import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { VisualDiffViewer } from '@/components/ui/VisualDiffViewer';
import { useHistoryStore } from '@/stores/historyStore';
import { useProjectStore } from '@/stores/projectStore';
import { buildTargetDocument } from '@/editor/targetDocument';
import { htmlToStructuredText } from '@/utils/hash';
import type { EditorBlock, HistorySnapshotMeta } from '@/types';

interface HistoryCompareModalProps {
  open: boolean;
  projectId: string;
  snapshotId: string | null;
  snapshots: HistorySnapshotMeta[];
  initialTargetSnapshotId?: string | undefined;
  onClose: () => void;
}

function parseSnapshotBlocks(snapshotJson: string): Record<string, EditorBlock> {
  return JSON.parse(snapshotJson) as Record<string, EditorBlock>;
}

export function HistoryCompareModal({
  open,
  projectId,
  snapshotId,
  snapshots,
  initialTargetSnapshotId,
  onClose,
}: HistoryCompareModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const getSnapshot = useHistoryStore((s) => s.getSnapshot);
  const [baseSnapshotId, setBaseSnapshotId] = useState<string>('');
  const [targetSnapshotId, setTargetSnapshotId] = useState<string>('');
  const [baseSnapshotBlocks, setBaseSnapshotBlocks] = useState<Record<string, EditorBlock> | null>(null);
  const [targetSnapshotBlocks, setTargetSnapshotBlocks] = useState<Record<string, EditorBlock> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isComparingWithCurrent = targetSnapshotId.length === 0;

  useEffect(() => {
    if (!open) return;
    setBaseSnapshotId(snapshotId ?? '');
    setTargetSnapshotId(initialTargetSnapshotId ?? '');
    setBaseSnapshotBlocks(null);
    setTargetSnapshotBlocks(null);
    setError(null);
  }, [open, snapshotId, initialTargetSnapshotId]);

  useEffect(() => {
    if (!baseSnapshotId) return;
    if (targetSnapshotId === baseSnapshotId) {
      setTargetSnapshotId('');
      setTargetSnapshotBlocks(null);
    }
  }, [baseSnapshotId, targetSnapshotId]);

  useEffect(() => {
    if (!open || !baseSnapshotId) return;
    let cancelled = false;

    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const baseSnapshot = await getSnapshot({ projectId, snapshotId: baseSnapshotId });
        if (!baseSnapshot.snapshotJson) {
          throw new Error('snapshotJson is empty');
        }
        const parsedBase = parseSnapshotBlocks(baseSnapshot.snapshotJson);

        let parsedTarget: Record<string, EditorBlock> | null = null;
        if (!isComparingWithCurrent) {
          const targetSnapshot = await getSnapshot({ projectId, snapshotId: targetSnapshotId });
          if (!targetSnapshot.snapshotJson) {
            throw new Error('snapshotJson is empty');
          }
          parsedTarget = parseSnapshotBlocks(targetSnapshot.snapshotJson);
        }

        if (cancelled) return;
        setBaseSnapshotBlocks(parsedBase);
        setTargetSnapshotBlocks(parsedTarget);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load snapshot');
          setBaseSnapshotBlocks(null);
          setTargetSnapshotBlocks(null);
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
  }, [open, baseSnapshotId, targetSnapshotId, isComparingWithCurrent, projectId, getSnapshot]);

  const baseSnapshotText = useMemo(() => {
    if (!project || !baseSnapshotBlocks) return '';
    const snapshotProject = { ...project, blocks: baseSnapshotBlocks };
    return htmlToStructuredText(buildTargetDocument(snapshotProject).text);
  }, [project, baseSnapshotBlocks]);

  const currentText = useMemo(() => {
    if (!project) return '';
    return htmlToStructuredText(buildTargetDocument(project).text);
  }, [project]);

  const targetText = useMemo(() => {
    if (isComparingWithCurrent) return currentText;
    if (!project || !targetSnapshotBlocks) return '';
    const snapshotProject = { ...project, blocks: targetSnapshotBlocks };
    return htmlToStructuredText(buildTargetDocument(snapshotProject).text);
  }, [project, isComparingWithCurrent, targetSnapshotBlocks, currentText]);

  const availableTargetSnapshots = useMemo(
    () => snapshots.filter((item) => item.id !== baseSnapshotId),
    [snapshots, baseSnapshotId],
  );

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

        <div className="px-4 py-3 border-b border-editor-border bg-editor-surface flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            <label htmlFor="history-compare-base" className="block text-xs text-editor-muted mb-1">
              {t('history.compareBaseSnapshot')}
            </label>
            <select
              id="history-compare-base"
              value={baseSnapshotId}
              onChange={(e) => setBaseSnapshotId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {snapshots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="history-compare-target" className="block text-xs text-editor-muted mb-1">
              {t('history.compareTarget')}
            </label>
            <select
              id="history-compare-target"
              value={targetSnapshotId}
              onChange={(e) => setTargetSnapshotId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-editor-border bg-editor-bg text-editor-text focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">{t('history.compareWithCurrent')}</option>
              {availableTargetSnapshots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 p-4 min-h-0">
          {loading && (
            <div className="text-sm text-editor-muted">{t('history.loading')}</div>
          )}
          {!loading && error && (
            <div className="text-sm text-red-500">{error}</div>
          )}
          {!loading && !error && (
            <VisualDiffViewer original={baseSnapshotText} suggested={targetText} />
          )}
        </div>
      </div>
    </Modal>
  );
}
