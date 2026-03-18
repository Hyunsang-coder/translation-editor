import i18n from '@/i18n/config';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { tipTapJsonToHtml } from '@/utils/markdownConverter';

export async function applyDesktopTranslationPreview(): Promise<void> {
  const preview = useTranslationPreviewStore.getState();
  const projectStore = useProjectStore.getState();
  const project = projectStore.project;

  if (!preview.docJson || !project) {
    throw new Error('No translation preview is available.');
  }

  const targetEditor = useEditorStore.getState().targetEditor;
  if (targetEditor) {
    replaceDocContent(targetEditor, preview.docJson, { addToHistory: true });
  } else {
    const html = tipTapJsonToHtml(preview.docJson);
    projectStore.setTargetDocJson(preview.docJson);
    projectStore.setTargetDocument(html);
  }

  useTranslationPreviewStore.getState().clearPreview();

  const blocks = useProjectStore.getState().materializeBlocksForSnapshot();
  if (!blocks) {
    return;
  }

  const model = useAiConfigStore.getState().translationModel;
  const dateLabel = new Date().toLocaleDateString('sv');
  await useHistoryStore.getState().createSnapshotIfChanged({
    projectId: project.id,
    description: `${i18n.t('history.autoSnapshotAfterTranslate')}(${model}/Claude Desktop) ${dateLabel}`,
    blocks,
  });
}

export function discardDesktopTranslationPreview(): void {
  useTranslationPreviewStore.getState().clearPreview();
}
