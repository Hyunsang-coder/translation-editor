import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';
import { buildExcerptSearchContext, findExcerptRange } from '@/components/review/reviewApply';
import { pluginKeys } from '@/editor/plugins/pluginKeys';

export interface ReviewHighlightOptions {
  highlightClass: string;
  excerptField: 'sourceExcerpt' | 'targetExcerpt';
}

const reviewHighlightPluginKey = pluginKeys.reviewHighlight;

/** 편집 중 decoration 전체 재계산을 지연하는 idle 디바운스 시간 (ms) */
const REVIEW_HIGHLIGHT_REFRESH_DEBOUNCE_MS = 300;

/**
 * 문서에서 텍스트를 찾아 Decoration 생성
 * - 노드 경계를 넘는 텍스트도 검색 가능
 * - 양방향 정규화: 에디터 텍스트와 검색 텍스트 모두 정규화하여 비교
 * - 이슈당 첫 번째 매치만 사용 (동일 텍스트 다중 매치 시 혼란 방지)
 */
export function createReviewDecorations(
  doc: ProseMirrorNode,
  issues: ReviewIssue[],
  highlightClass: string,
  excerptField: 'sourceExcerpt' | 'targetExcerpt',
): DecorationSet {
  const decorations: Decoration[] = [];
  // 텍스트/매핑은 한 번만 계산해 이슈별 검색에 재사용
  const searchContext = buildExcerptSearchContext(doc);

  issues.forEach((issue) => {
    const range = findExcerptRange(doc, issue[excerptField], issue.segmentGroupId, searchContext);
    if (!range) {
      return;
    }

    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: highlightClass,
        'data-issue-id': issue.id,
        'data-issue-type': issue.type,
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Review Highlight Extension
 * 체크된 이슈의 targetExcerpt를 에디터에서 하이라이트합니다.
 */
export const ReviewHighlight = Extension.create<ReviewHighlightOptions>({
  name: 'reviewHighlight',

  addOptions() {
    return {
      highlightClass: 'review-highlight',
      excerptField: 'targetExcerpt' as const,
    };
  },

  addProseMirrorPlugins() {
    const { highlightClass, excerptField } = this.options;

    return [
      new Plugin({
        key: reviewHighlightPluginKey,

        state: {
          init: (_, state) => {
            const { highlightEnabled, getCheckedIssues } = useReviewStore.getState();

            if (!highlightEnabled) {
              return DecorationSet.empty;
            }

            const checkedIssues = getCheckedIssues();
            return createReviewDecorations(state.doc, checkedIssues, highlightClass, excerptField);
          },

          apply: (tr, oldDecorationSet, _oldState, newState) => {
            const { highlightEnabled, getCheckedIssues } = useReviewStore.getState();

            // 하이라이트 비활성화 상태
            if (!highlightEnabled) {
              return DecorationSet.empty;
            }

            // meta refresh(highlightNonce 갱신 또는 디바운스된 재계산 요청) 시에만 전체 재계산
            if (tr.getMeta('reviewHighlightRefresh')) {
              const checkedIssues = getCheckedIssues();
              return createReviewDecorations(newState.doc, checkedIssues, highlightClass, excerptField);
            }

            // P2 최적화: 편집(docChanged) 시에는 기존 decoration 위치만 매핑하고,
            // 이슈별 excerpt 재검색(O(k·n))은 디바운스된 refresh(view.update)로 지연.
            // 적용(reviewApply) 경로는 적용 시점에 항상 재검색하므로 정확성에 영향 없음.
            return oldDecorationSet.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return reviewHighlightPluginKey.getState(state);
          },
        },

        view: () => {
          let refreshTimer: ReturnType<typeof setTimeout> | null = null;

          return {
            update: (view, prevState) => {
              if (view.state.doc === prevState.doc) return;
              if (!useReviewStore.getState().highlightEnabled) return;

              // 편집이 멈춘 뒤 한 번만 전체 재계산 (키 입력당 재계산 방지)
              if (refreshTimer !== null) clearTimeout(refreshTimer);
              refreshTimer = setTimeout(() => {
                refreshTimer = null;
                if (view.isDestroyed) return;
                if (!useReviewStore.getState().highlightEnabled) return;
                view.dispatch(view.state.tr.setMeta('reviewHighlightRefresh', true));
              }, REVIEW_HIGHLIGHT_REFRESH_DEBOUNCE_MS);
            },
            destroy: () => {
              if (refreshTimer !== null) {
                clearTimeout(refreshTimer);
                refreshTimer = null;
              }
            },
          };
        },
      }),
    ];
  },
});

/**
 * 에디터의 하이라이트를 새로고침하는 헬퍼 함수
 * 에디터 인스턴스와 함께 호출하면 decoration이 재계산됩니다.
 */
export function refreshEditorHighlight(editor: Editor): void {
  const tr = editor.view.state.tr.setMeta('reviewHighlightRefresh', true);
  editor.view.dispatch(tr);
}
