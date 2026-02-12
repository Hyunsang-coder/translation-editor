import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';

interface SaveSnapshotDialogProps {
  open: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (description: string) => Promise<void> | void;
}

export function SaveSnapshotDialog({
  open,
  isSaving = false,
  onClose,
  onSave,
}: SaveSnapshotDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) {
      setDescription('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} labelId="history-save-title" className="bg-black/40 p-4">
      <div className="w-full max-w-md bg-editor-surface border border-editor-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-editor-border">
          <h3 id="history-save-title" className="text-sm font-semibold text-editor-text">
            {t('history.saveSnapshot')}
          </h3>
        </div>
        <div className="p-4 space-y-2">
          <label htmlFor="history-description" className="text-xs text-editor-muted">
            {t('history.descriptionOptional')}
          </label>
          <textarea
            id="history-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('history.descriptionPlaceholder')}
            className="w-full h-28 px-3 py-2 text-sm rounded border border-editor-border bg-editor-bg text-editor-text placeholder:text-editor-muted resize-none focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="px-4 py-3 border-t border-editor-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-editor-border text-editor-text hover:bg-editor-bg transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void onSave(description.trim())}
            disabled={isSaving}
            className="px-3 py-1.5 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
          >
            {isSaving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
