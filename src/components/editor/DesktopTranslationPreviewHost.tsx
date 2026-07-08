import { useTranslation } from 'react-i18next';
import { TranslatePreviewModal } from '@/components/editor/TranslatePreviewModal';
import {
  applyDesktopTranslationPreview,
  discardDesktopTranslationPreview,
  DesktopPreviewApplyError,
} from '@/desktop/translationPreviewActions';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { useUIStore } from '@/stores/uiStore';

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

  // L3: apply 가드(프로젝트/리비전 재검증) 실패를 토스트로 사용자에게 알린다.
  // 외부 브리지 경로(oddeyes.applyTranslationPreview)는 동일 에러가 MCP 호출자에게 전달된다.
  const handleApply = async (): Promise<void> => {
    try {
      await applyDesktopTranslationPreview();
    } catch (e) {
      const addToast = useUIStore.getState().addToast;
      if (e instanceof DesktopPreviewApplyError) {
        if (e.code === 'project_mismatch') {
          addToast({
            type: 'warning',
            message: t('editor.applyCancelledProjectSwitched', '프로젝트가 전환되어 적용을 취소했습니다.'),
          });
          discardDesktopTranslationPreview();
          return;
        }
        if (e.code === 'revision_mismatch') {
          addToast({
            type: 'warning',
            message: t('editor.applyCancelledDocChanged', '번역 요청 이후 문서가 수정되어 적용을 취소했습니다. 문서를 확인한 뒤 다시 실행해주세요.'),
          });
          return;
        }
      }
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <TranslatePreviewModal
      open={open}
      title={title ?? t('editor.previewDefaultTitle')}
      docJson={docJson}
      sourceHtml={sourceHtml}
      originalHtml={originalHtml}
      onClose={discardDesktopTranslationPreview}
      onCancel={discardDesktopTranslationPreview}
      onApply={handleApply}
    />
  );
}
