import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';

export interface ReviewHighlightOptions {
  highlightClass: string;
  excerptField: 'sourceExcerpt' | 'targetExcerpt';
}

const reviewHighlightPluginKey = new PluginKey('reviewHighlight');

/**
 * 문서에서 텍스트를 찾아 Decoration 생성
 */
function createDecorations(
  doc: ProseMirrorNode,
  issues: ReviewIssue[],
  highlightClass: string,
  excerptField: 'sourceExcerpt' | 'targetExcerpt',
): DecorationSet {
  const decorations: Decoration[] = [];

  issues.forEach((issue) => {
    const searchText = issue[excerptField];
    if (!searchText) return;
    let found = false;

    // 문서의 모든 텍스트 노드 순회
    doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
      if (found) return false; // 첫 번째 매치만 사용
      if (!node.isText || !node.text) return;

      const text = node.text;
      const index = text.indexOf(searchText);

      if (index !== -1) {
        const from = pos + index;
        const to = from + searchText.length;

        decorations.push(
          Decoration.inline(from, to, {
            class: highlightClass,
            'data-issue-id': issue.id,
            'data-issue-type': issue.type,
          }),
        );
        found = true;
        return false;
      }
    });
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
            return createDecorations(state.doc, checkedIssues, highlightClass, excerptField);
          },

          apply: (tr, oldDecorationSet, _oldState, newState) => {
            const { highlightEnabled, getCheckedIssues } = useReviewStore.getState();

            // 하이라이트 비활성화 상태
            if (!highlightEnabled) {
              return DecorationSet.empty;
            }

            // 문서가 변경되었거나 meta에 refresh 플래그가 있으면 재계산
            if (tr.docChanged || tr.getMeta('reviewHighlightRefresh')) {
              const checkedIssues = getCheckedIssues();
              return createDecorations(newState.doc, checkedIssues, highlightClass, excerptField);
            }

            // 변경 없으면 기존 decoration 유지 (position mapping)
            return oldDecorationSet.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return reviewHighlightPluginKey.getState(state);
          },
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
