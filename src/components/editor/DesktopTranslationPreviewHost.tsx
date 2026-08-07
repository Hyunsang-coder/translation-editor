import { useTranslation } from 'react-i18next';
import { message } from '@tauri-apps/plugin-dialog';
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

  // L3: apply 가드(프로젝트/리비전 재검증) 실패를 사용자에게 알린다.
  // 적용 취소는 AI 결과가 통째로 버려지는 상황이라 토스트 대신 팝업으로 띄운다.
  // 외부 브리지 경로(oddeyes.applyTranslationPreview)는 동일 에러가 MCP 호출자에게 전달된다.
  const handleApply = async (): Promise<void> => {
    try {
      await applyDesktopTranslationPreview();
    } catch (e) {
      const cancelTitle = t('editor.applyCancelledTitle', '적용 취소');
      if (e instanceof DesktopPreviewApplyError) {
        if (e.code === 'project_mismatch') {
          await message(
            t('editor.applyCancelledProjectSwitched', '프로젝트가 전환되어 적용을 취소했습니다.'),
            { title: cancelTitle, kind: 'warning' },
          );
          discardDesktopTranslationPreview();
          return;
        }
        if (e.code === 'revision_mismatch') {
          await message(
            t('editor.applyCancelledDocChanged', '번역 요청 이후 문서가 수정되어 적용을 취소했습니다. 문서를 확인한 뒤 다시 실행해주세요.'),
            { title: cancelTitle, kind: 'warning' },
          );
          return;
        }
      }
      useUIStore.getState().addToast({
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
