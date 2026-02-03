import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { useReviewStore, type ReviewIssue } from '@/stores/reviewStore';
import {
  normalizeForSearch,
  buildNormalizedTextWithMapping,
} from '@/utils/normalizeForSearch';
import { findSegmentRange } from '@/editor/extensions/SearchHighlight';
import { hasSegmentGroupId, normalizeSegmentGroupId } from '@/components/review/reviewApply';

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
  const { text: fullText, positions } = buildTextWithPositions(doc);

  // 에디터 텍스트도 정규화하고 원본 인덱스 매핑 구축
  const { normalizedText: normalizedFullText, indexMap: fullTextIndexMap } =
    buildNormalizedTextWithMapping(fullText);

  // 디버깅: 에디터에서 추출한 전체 텍스트 (처음 500자)
  console.log(`[ReviewHighlight:${excerptField}] fullText (first 500):`, fullText.slice(0, 500));
  console.log(
    `[ReviewHighlight:${excerptField}] normalizedFullText (first 500):`,
    normalizedFullText.slice(0, 500),
  );
  console.log(`[ReviewHighlight:${excerptField}] issues count:`, issues.length);

  const hasSegmentGroups = hasSegmentGroupId(doc);

  issues.forEach((issue, idx) => {
    const rawSearchText = issue[excerptField];
    if (!rawSearchText || rawSearchText.length === 0) {
      console.log(`[ReviewHighlight:${excerptField}] issue #${idx}: empty excerpt, skipping`);
      return;
    }

    // 검색 텍스트 정규화 (마크다운 서식 + 공백 정규화)
    const searchText = normalizeForSearch(rawSearchText);
    if (searchText.length === 0) {
      console.log(
        `[ReviewHighlight:${excerptField}] issue #${idx}: empty after normalizeForSearch, skipping`,
      );
      return;
    }

    const normalizedSegmentGroupId = normalizeSegmentGroupId(issue.segmentGroupId);
    const segmentRange = normalizedSegmentGroupId
      ? findSegmentRange(doc, normalizedSegmentGroupId)
      : null;
    if (issue.segmentGroupId && hasSegmentGroups && !segmentRange) {
      console.log(
        `[ReviewHighlight:${excerptField}] issue #${idx}: segmentGroupId not found, skipping`,
      );
      return;
    }

    let normalizedIndex = -1;
    let found = false;
    let searchFrom = 0;

    while ((normalizedIndex = normalizedFullText.indexOf(searchText, searchFrom)) !== -1) {
      if (normalizedIndex >= fullTextIndexMap.length) {
        break;
      }

      // 정규화된 인덱스 → 원본 텍스트 인덱스 → 문서 위치
      const originalStartIndex = fullTextIndexMap[normalizedIndex];
      if (originalStartIndex === undefined) {
        searchFrom = normalizedIndex + 1;
        continue;
      }

      const normalizedEndIndex = normalizedIndex + searchText.length - 1;
      const originalEndIndex =
        normalizedEndIndex < fullTextIndexMap.length
          ? fullTextIndexMap[normalizedEndIndex]
          : undefined;

      if (originalEndIndex === undefined) {
        searchFrom = normalizedIndex + 1;
        continue;
      }

      // 원본 텍스트 인덱스 → 문서 위치
      const from = positions[originalStartIndex];
      const to = positions[originalEndIndex];

      if (from === undefined || to === undefined) {
        searchFrom = normalizedIndex + 1;
        continue;
      }

      const toExclusive = to + 1;
      const inSegmentRange = !segmentRange || (from >= segmentRange.from && toExclusive <= segmentRange.to);

      if (toExclusive > from && inSegmentRange) {
        decorations.push(
          Decoration.inline(from, toExclusive, {
            class: highlightClass,
            'data-issue-id': issue.id,
            'data-issue-type': issue.type,
          }),
        );
        found = true;
        break;
      }

      searchFrom = normalizedIndex + 1;
    }

    // 디버깅: 검색 결과
    console.log(`[ReviewHighlight:${excerptField}] issue #${idx}:`, {
      raw: rawSearchText,
      stripped: searchText,
      found,
      normalizedIndex,
      type: issue.type,
      segmentGroupId: issue.segmentGroupId,
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
            return createReviewDecorations(state.doc, checkedIssues, highlightClass, excerptField);
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
              return createReviewDecorations(newState.doc, checkedIssues, highlightClass, excerptField);
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
