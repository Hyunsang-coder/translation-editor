import { useTranslation } from 'react-i18next';
import { TranslatePreviewModal } from '@/components/editor/TranslatePreviewModal';
import { applyDesktopTranslationPreview, discardDesktopTranslationPreview } from '@/desktop/translationPreviewActions';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';

export function DesktopTranslationPreviewHost(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useTranslationPreviewStore((s) => s.open);
  const title = useTranslationPreviewStore((s) => s.title);
  const docJson = useTranslationPreviewStore((s) => s.docJson);
  const sourceHtml = useTranslationPreviewStore((s) => s.sourceHtml);
  const originalHtml = useTranslationPreviewStore((s) => s.originalHtml);

  if (!open) {
    return null;
  }

  return (
    <TranslatePreviewModal
      open={open}
      title={title ?? t('editor.previewDefaultTitle')}
      docJson={docJson}
      sourceHtml={sourceHtml}
      originalHtml={originalHtml}
      onClose={discardDesktopTranslationPreview}
      onCancel={discardDesktopTranslationPreview}
      onApply={() => applyDesktopTranslationPreview()}
    />
  );
}
