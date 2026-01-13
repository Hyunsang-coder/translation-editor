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
 * 문서의 전체 텍스트와 위치 매핑 구축
 * 노드 경계를 넘는 텍스트 검색을 위해 필요
 */
function buildTextWithPositions(doc: ProseMirrorNode): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = []; // positions[i] = text[i]에 해당하는 doc 내 위치

  doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        positions.push(pos + i);
      }
      text += node.text;
    }
  });

  return { text, positions };
}

/**
 * 문서에서 텍스트를 찾아 Decoration 생성
 * - 노드 경계를 넘는 텍스트도 검색 가능
 * - 이슈당 첫 번째 매치만 사용 (동일 텍스트 다중 매치 시 혼란 방지)
 */
function createDecorations(
  doc: ProseMirrorNode,
  issues: ReviewIssue[],
  highlightClass: string,
  excerptField: 'sourceExcerpt' | 'targetExcerpt',
): DecorationSet {
  const decorations: Decoration[] = [];
  const { text: fullText, positions } = buildTextWithPositions(doc);

  issues.forEach((issue) => {
    const searchText = issue[excerptField];
    if (!searchText || searchText.length === 0) return;

    // 전체 텍스트에서 검색 (노드 경계 무시)
    const index = fullText.indexOf(searchText);

    if (index !== -1 && index < positions.length) {
      const from = positions[index];
      const endIndex = index + searchText.length - 1;
      // endIndex가 positions 범위 내인지 확인
      const to = endIndex < positions.length ? positions[endIndex]! + 1 : from + searchText.length;

      if (from !== undefined && to > from) {
        decorations.push(
          Decoration.inline(from, to, {
            class: highlightClass,
            'data-issue-id': issue.id,
            'data-issue-type': issue.type,
          }),
        );
      }
    }
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
