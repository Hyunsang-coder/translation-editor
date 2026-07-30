import i18n from '@/i18n/config';
import { replaceDocContent } from '@/editor/utils/replaceDocContent';
import { getModelIdForUse } from '@/ai/config';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslationPreviewStore } from '@/stores/translationPreviewStore';
import { hashContent } from '@/utils/hash';
import {
  htmlToTipTapJson,
  tipTapJsonToHtml,
  tipTapJsonToMarkdownForTranslation,
  type TipTapDocJson,
} from '@/utils/markdownConverter';

export type DesktopPreviewApplyErrorCode = 'no_preview' | 'project_mismatch' | 'revision_mismatch';

/**
 * Desktop 프리뷰 apply 거부 사유를 코드로 구분해, UI(토스트 i18n)와
 * 외부 MCP 호출자(oddeyes.applyTranslationPreview) 양쪽이 원인을 식별할 수 있게 한다.
 */
export class DesktopPreviewApplyError extends Error {
  readonly code: DesktopPreviewApplyErrorCode;

  constructor(code: DesktopPreviewApplyErrorCode, message: string) {
    super(message);
    this.name = 'DesktopPreviewApplyError';
    this.code = code;
  }
}

/**
 * 현재 Target 문서의 revision.
 * oddeyesAppBridge의 buildDocumentSnapshot과 동일 산식(markdown 변환 후 hashContent)을 사용해
 * set 시점에 기록된 targetRevision과 비교 가능해야 한다.
 * 살아있는 에디터가 있으면 그것이 최신이다(스토어 JSON 캐시는 디바운스로 뒤처질 수 있음).
 */
export function computeCurrentTargetRevision(): string {
  const targetEditor = useEditorStore.getState().targetEditor;
  if (targetEditor && !targetEditor.isDestroyed) {
    try {
      return hashContent(tipTapJsonToMarkdownForTranslation(targetEditor.getJSON() as TipTapDocJson));
    } catch {
      // 에디터 직렬화 실패 시 스토어 캐시로 폴백
    }
  }
  const projectStore = useProjectStore.getState();
  const docJson = projectStore.targetDocJson ?? htmlToTipTapJson(projectStore.targetDocument || '');
  return hashContent(tipTapJsonToMarkdownForTranslation(docJson));
}

export async function applyDesktopTranslationPreview(): Promise<void> {
  const preview = useTranslationPreviewStore.getState();
  const projectStore = useProjectStore.getState();
  const project = projectStore.project;

  if (!preview.docJson || !project) {
    throw new DesktopPreviewApplyError('no_preview', 'No translation preview is available.');
  }

  // L3 가드 ①: 프리뷰가 만들어진 프로젝트와 현재 프로젝트가 같아야 한다.
  // (switchProjectById/loadProject가 clearPreview를 호출하므로 보통 도달하지 않지만,
  //  외부 브리지가 전환 경합 중 apply를 호출하는 경우를 막는 최종 방어선)
  if (preview.projectId !== null && preview.projectId !== project.id) {
    throw new DesktopPreviewApplyError(
      'project_mismatch',
      `Translation preview belongs to project ${preview.projectId}, but the active project is ${project.id}. Set a new preview for the active project and try again.`,
    );
  }

  // L3 가드 ②: set 이후 사용자가 Target을 편집했으면 적용하지 않는다(편집 유실 방지).
  // NOTE(제품 결정 필요, 리뷰 2026-07-07 §7): 같은 프로젝트 내 "set 후 사용자 편집" 충돌은
  // 보수적 기본값으로 하드 차단한다. "경고 후 강제 적용" 옵션이 필요하면 여기서 분기할 것.
  if (preview.targetRevision !== null) {
    const currentRevision = computeCurrentTargetRevision();
    if (currentRevision !== preview.targetRevision) {
      throw new DesktopPreviewApplyError(
        'revision_mismatch',
        'Target document has changed since the preview was created. Fetch the latest target document and set a new preview.',
      );
    }
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

  const model = getModelIdForUse('translation');
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
