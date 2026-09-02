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

  // 이슈 구간을 '선택'하지 않고 캐럿만 그 앞에 둔다.
  // - 범위 선택을 만들면 인라인 툴바까지 떠서 카드를 누를 때마다 화면이 어수선했다.
  //   buildSelectionBubble은 빈 범위를 걸러내므로 캐럿은 툴바를 띄우지 않는다.
  // - 그렇다고 캐럿을 아예 안 옮기면, 나중에 에디터가 포커스를 받을 때 브라우저가
  //   문서 맨 앞의 캐럿을 노출시키며 스크롤을 최상단으로 되돌린다.
  // - 포커스는 옮기지 않는다. 검수 패널이 포커스를 유지해야 카드 간 이동이 끊기지 않고,
  //   포커스가 만드는 자체 스크롤이 방금 맞춘 위치를 덮어쓰던 문제도 사라진다.
  // 이슈 구간 자체는 ReviewHighlight가 칠하므로 선택 없이도 어디인지 보인다.
  const primaryEditor = navigation.primarySide === 'source' ? source : target;
  const primaryAnchor = navigation.primarySide === 'source' ? navigation.source : navigation.target;
  if (primaryEditor && primaryAnchor.kind === 'exact-range' && primaryAnchor.range) {
    const caret = primaryAnchor.range.from;
    primaryEditor.commands.setTextSelection({ from: caret, to: caret });
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
