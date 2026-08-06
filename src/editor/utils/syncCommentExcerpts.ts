import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useCommentStore } from '@/stores/commentStore';

interface MarkedRange {
  from: number;
  to: number;
}

function collectMarkedRanges(
  doc: ProseMirrorNode,
  commentId: string,
): MarkedRange[] {
  const ranges: MarkedRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const marked = node.marks.some(
      (mark) => mark.type.name === 'comment' && mark.attrs?.commentId === commentId,
    );
    if (!marked) return;

    const to = pos + node.nodeSize;
    const previous = ranges[ranges.length - 1];
    if (previous && previous.to === pos) {
      previous.to = to;
    } else {
      ranges.push({ from: pos, to });
    }
  });
  return ranges;
}

/**
 * ProseMirror comment mark를 위치 진실 공급원으로 삼아 store excerpt를 다시 만든다.
 * 같은 commentId가 표 다중 셀처럼 떨어진 범위에 있으면 원래 선택 표현과 같이 줄바꿈으로
 * 연결한다. 마크가 모두 사라졌으면 저장 debounce를 기다리지 않고 고아 항목을 제거한다.
 */
export function syncCommentExcerpts(
  editor: Editor,
  commentIds: readonly string[],
): void {
  const store = useCommentStore.getState();
  for (const commentId of new Set(commentIds)) {
    const ranges = collectMarkedRanges(editor.state.doc, commentId);
    if (ranges.length === 0) {
      store.removeComment(commentId);
      continue;
    }
    const excerpt = ranges
      .map((range) => editor.state.doc.textBetween(range.from, range.to, '\n'))
      .join('\n')
      .trim();
    if (excerpt) {
      store.updateComment(commentId, { excerpt });
    } else {
      store.removeComment(commentId);
    }
  }
}
