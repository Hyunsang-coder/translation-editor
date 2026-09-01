/**
 * 검수 이슈 위치 이동의 단일 진입점.
 *
 * 검수 카드와 정렬 화면 이슈 배지가 **같은 경로**를 쓴다 — 진입점마다 위치 결정이
 * 달라지면 "카드에서는 되는데 정렬에서는 다른 데로 간다"가 생긴다.
 *
 * 하지 않는 것: 숨겨진 패널을 다시 열지 않고, 패널 너비를 바꾸지 않고,
 * 심각도 필터를 건드리지 않는다. 위치를 못 찾으면 그냥 이동하지 않는다.
 */

import type { Editor } from '@tiptap/react';
import i18n from '@/i18n/config';
import type { ReviewIssue } from '@/stores/reviewStore';
import { useReviewStore } from '@/stores/reviewStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import type { TranslationUnitDocument } from '@/editor/extensions/TranslationUnitId';
import {
  resolveReviewIssueNavigation,
  scrollEditorToAnchor,
} from '@/editor/utils/reviewIssueNavigation';

/** 이동 요청 출처 — 부수 동작(검수 패널 열기)만 다르고 위치 계산은 같다. */
export type ReviewIssueNavigationOrigin = 'review-card' | 'alignment-row';

function liveEditor(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed ? editor : null;
}

function moveEditors(issue: ReviewIssue): void {
  const { sourceEditor, targetEditor } = useEditorStore.getState();
  const { focusMode, sourceOnlyMode, editorZoom, addToast } = useUIStore.getState();

  // 보기 모드로 숨겨진 패널은 DOM 좌표를 측정하지도, 강제로 열지도 않는다.
  const source = focusMode ? null : liveEditor(sourceEditor);
  const target = sourceOnlyMode ? null : liveEditor(targetEditor);

  // 에디터가 없는 쪽도 스냅샷이 있으면 대응 유닛 계산에는 쓸 수 있다
  // (원문 숨김 모드의 누락 이슈 → 번역문 대응 유닛).
  const project = useProjectStore.getState();
  const navigation = resolveReviewIssueNavigation({
    issue,
    sourceDoc: source?.state.doc ?? null,
    targetDoc: target?.state.doc ?? null,
    ...(source
      ? {}
      : { sourceDocJson: (project.sourceDocJson as TranslationUnitDocument | null) ?? null }),
    ...(target
      ? {}
      : { targetDocJson: (project.targetDocJson as TranslationUnitDocument | null) ?? null }),
  });

  // 선택·포커스를 스크롤보다 먼저 끝낸다 — 순서가 뒤집히면 포커스가 만드는
  // 자체 스크롤이 방금 맞춘 위치를 덮어쓴다.
  const primaryEditor = navigation.primarySide === 'source' ? source : target;
  const primaryAnchor = navigation.primarySide === 'source' ? navigation.source : navigation.target;
  if (primaryEditor && primaryAnchor.kind === 'exact-range' && primaryAnchor.range) {
    primaryEditor.commands.setTextSelection(primaryAnchor.range);
    primaryEditor.commands.focus(undefined, { scrollIntoView: false });
  }

  // 두 패널은 서로의 scrollTop을 복사하지 않는다 — 각자의 앵커를 각자 상단으로.
  const movedSource = source ? scrollEditorToAnchor(source, navigation.source, editorZoom) : false;
  const movedTarget = target ? scrollEditorToAnchor(target, navigation.target, editorZoom) : false;

  if (!movedSource && !movedTarget) {
    addToast({ type: 'warning', message: i18n.t('review.issuePositionNotFound') });
  }
}

/**
 * 이슈를 원문·번역문 패널에서 찾아간다. 이미 해결·무시된 이슈면 아무것도 하지 않는다.
 */
export function navigateToReviewIssue(
  issueId: string,
  origin: ReviewIssueNavigationOrigin,
): void {
  const issue = useReviewStore.getState().getAllIssues().find((item) => item.id === issueId);
  if (!issue) return;

  const ui = useUIStore.getState();
  // 정렬 화면에서는 검수 패널이 아직 마운트되지 않았을 수 있다 — 카드 이동은 요청으로 남긴다.
  if (origin === 'alignment-row') ui.openReviewPanel();
  ui.requestReviewIssueNavigation(issueId);

  const needsModeSwitch = ui.editorViewMode !== 'document';
  if (!needsModeSwitch) {
    moveEditors(issue);
    return;
  }

  ui.setEditorViewMode('document');
  // 정렬 오버레이가 걷히기 전의 좌표는 믿을 수 없다. 한 프레임만 기다린다(재시도 없음).
  requestAnimationFrame(() => moveEditors(issue));
}
