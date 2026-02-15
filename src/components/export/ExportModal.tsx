import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { useProjectStore } from '@/stores/projectStore';
import { useReviewStore } from '@/stores/reviewStore';
import { pickExportDocumentPath } from '@/tauri/dialog';
import { invoke } from '@/tauri/invoke';
import { isTauriRuntime } from '@/tauri/invoke';
import { useUIStore } from '@/stores/uiStore';
import {
  exportDocument,
  exportToDocx,
  exportToPdf,
  copyToClipboard,
  type ContentMode,
  type BilingualLayout,
  type ExportFormat,
  type ExportInput,
  type ExportOptions,
} from '@/utils/exportDocument';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ExportModal({ open, onClose }: ExportModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);

  const [contentMode, setContentMode] = useState<ContentMode>('target');
  const [bilingualLayout, setBilingualLayout] = useState<BilingualLayout>('table');
  const [format, setFormat] = useState<ExportFormat>('html');
  const [includeReview, setIncludeReview] = useState(false);
  const [busy, setBusy] = useState(false);

  const buildInput = useCallback((): ExportInput | null => {
    const { sourceDocJson, targetDocJson, project } = useProjectStore.getState();
    if (!project || (!sourceDocJson && !targetDocJson)) return null;

    const reviewIssues = includeReview ? useReviewStore.getState().getAllIssues() : [];
    return {
      sourceJson: sourceDocJson,
      targetJson: targetDocJson,
      reviewIssues,
    };
  }, [includeReview]);

  const buildOptions = useCallback((): ExportOptions => {
    const title = useProjectStore.getState().project?.metadata.title ?? 'document';
    return { contentMode, bilingualLayout, format, includeReview, projectTitle: title };
  }, [contentMode, bilingualLayout, format, includeReview]);

  const isBinaryFormat = format === 'pdf' || format === 'docx';

  const handleCopy = useCallback(async () => {
    const input = buildInput();
    if (!input) {
      addToast({ type: 'warning', message: t('export.noDocument') });
      return;
    }
    setBusy(true);
    try {
      await copyToClipboard(input, buildOptions());
      addToast({ type: 'success', message: t('export.copied') });
      onClose();
    } catch {
      addToast({ type: 'error', message: t('export.error') });
    } finally {
      setBusy(false);
    }
  }, [buildInput, buildOptions, addToast, t, onClose]);

  const handleSave = useCallback(async () => {
    const input = buildInput();
    if (!input) {
      addToast({ type: 'warning', message: t('export.noDocument') });
      return;
    }
    setBusy(true);
    try {
      const options = buildOptions();
      const defaultName = options.projectTitle.replace(/[/\\?%*:|"<>]/g, '_');

      if (format === 'pdf' || format === 'docx') {
        const data = format === 'pdf'
          ? await exportToPdf(input, options)
          : await exportToDocx(input, options);

        if (isTauriRuntime()) {
          const path = await pickExportDocumentPath(format, defaultName);
          if (!path) {
            setBusy(false);
            return;
          }
          await invoke('write_binary_file', { path, data: Array.from(data) });
        } else {
          const mimeMap = {
            pdf: 'application/pdf',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          } as const;
          const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeMap[format] });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${defaultName}.${format}`;
          a.click();
          URL.revokeObjectURL(url);
        }

        addToast({ type: 'success', message: t('export.success') });
        onClose();
        return;
      }

      // HTML / Markdown
      const content = exportDocument(input, options);

      if (isTauriRuntime()) {
        const path = await pickExportDocumentPath(format, defaultName);
        if (!path) {
          setBusy(false);
          return;
        }
        await invoke('write_text_file', { path, content });
      } else {
        // Web fallback: download via blob
        const ext = format === 'markdown' ? 'md' : 'html';
        const mime = format === 'markdown' ? 'text/markdown' : 'text/html';
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${defaultName}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }

      addToast({ type: 'success', message: t('export.success') });
      onClose();
    } catch (err) {
      console.error('[Export] save failed:', err);
      addToast({ type: 'error', message: t('export.error') });
    } finally {
      setBusy(false);
    }
  }, [buildInput, buildOptions, format, addToast, t, onClose]);

  const isBilingual = contentMode === 'bilingual';
  // Markdown에서 table 레이아웃은 비활성화
  const isTableDisabled = format === 'markdown';

  return (
    <Modal open={open} onClose={onClose} labelId="export-modal-title" className="bg-black/50">
      <div className="bg-editor-surface border border-editor-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 id="export-modal-title" className="text-lg font-semibold text-editor-text">
            {t('export.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-editor-muted hover:text-editor-text transition-colors text-lg leading-none"
            aria-label={t('common.close')}
          >
            &times;
          </button>
        </div>

        {/* Content Mode */}
        <fieldset className="mb-4">
          <legend className="text-xs font-medium text-editor-muted uppercase tracking-wide mb-2">
            {t('export.contentSection')}
          </legend>
          <div className="flex gap-3">
            {(['target', 'source', 'bilingual'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-1.5 text-sm text-editor-text cursor-pointer">
                <input
                  type="radio"
                  name="contentMode"
                  value={mode}
                  checked={contentMode === mode}
                  onChange={() => setContentMode(mode)}
                  className="accent-blue-500"
                />
                {t(`export.${mode}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Bilingual Layout (only when bilingual) */}
        {isBilingual && (
          <fieldset className="mb-4">
            <legend className="text-xs font-medium text-editor-muted uppercase tracking-wide mb-2">
              {t('export.layoutSection')}
            </legend>
            <div className="flex gap-3">
              {(['table', 'interleaved', 'sequential'] as const).map((layout) => {
                const disabled = layout === 'table' && isTableDisabled;
                return (
                  <label
                    key={layout}
                    className={`flex items-center gap-1.5 text-sm cursor-pointer ${disabled ? 'text-editor-muted opacity-50 cursor-not-allowed' : 'text-editor-text'}`}
                  >
                    <input
                      type="radio"
                      name="bilingualLayout"
                      value={layout}
                      checked={bilingualLayout === layout}
                      onChange={() => setBilingualLayout(layout)}
                      disabled={disabled}
                      className="accent-blue-500"
                    />
                    {t(`export.${layout}`)}
                  </label>
                );
              })}
            </div>
            {/* Layout preview */}
            <LayoutPreview layout={bilingualLayout} />
          </fieldset>
        )}

        {/* Format */}
        <fieldset className="mb-4">
          <legend className="text-xs font-medium text-editor-muted uppercase tracking-wide mb-2">
            {t('export.formatSection')}
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(['html', 'markdown', 'pdf', 'docx'] as const).map((fmt) => (
              <label key={fmt} className="flex items-center gap-1.5 text-sm text-editor-text cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  value={fmt}
                  checked={format === fmt}
                  onChange={() => {
                    setFormat(fmt);
                    // table 비활성화 시 자동 전환
                    if (fmt === 'markdown' && bilingualLayout === 'table') {
                      setBilingualLayout('interleaved');
                    }
                  }}
                  className="accent-blue-500"
                />
                {t(`export.${fmt}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Include review */}
        <label className="flex items-center gap-2 text-sm text-editor-text mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={includeReview}
            onChange={(e) => setIncludeReview(e.target.checked)}
            className="accent-blue-500"
          />
          {t('export.includeReview')}
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={busy || isBinaryFormat}
            title={isBinaryFormat ? t('export.binaryNoCopy') : undefined}
            className="px-4 py-2 text-sm rounded-lg border border-editor-border text-editor-text hover:bg-editor-border/60 transition-colors disabled:opacity-50"
          >
            {t('export.copyToClipboard')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {t('export.saveToFile')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Simple ASCII-art layout preview */
function LayoutPreview({ layout }: { layout: BilingualLayout }): JSX.Element {
  const previewMap: Record<BilingualLayout, string> = {
    table: '┌──────┬──────┐\n│Source│Target│\n├──────┼──────┤\n│ ...  │ ...  │\n└──────┴──────┘',
    interleaved: '▎ Source paragraph\n  Target paragraph\n\n▎ Source paragraph\n  Target paragraph',
    sequential: 'Source document\n────────────────\nTarget document',
  };

  return (
    <pre className="mt-2 p-2 text-[10px] leading-tight text-editor-muted bg-editor-bg rounded border border-editor-border font-mono whitespace-pre select-none">
      {previewMap[layout]}
    </pre>
  );
}
