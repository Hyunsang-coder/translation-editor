/**
 * CommentMark 위치 탐색/네비게이션 유틸.
 *
 * 코멘트의 위치 진실 공급원은 `CommentMark`(commentId attrs)다. excerpt 검색이 아니라
 * 마크 범위를 직접 찾으므로 편집으로 텍스트가 이동해도 정확하다(ProseMirror가 위치 추적).
 */

import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * 문서에서 주어진 commentId 마크가 적용된 범위를 찾는다.
 * 같은 commentId가 여러 텍스트 노드에 걸쳐 있으면 최소~최대 위치로 병합한다.
 *
 * @returns 마크 범위 { from, to }, 없으면 null(고아)
 */
export function findCommentRange(
  doc: ProseMirrorNode,
  commentId: string,
): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;

  doc.descendants((node: ProseMirrorNode, pos: number): boolean | void => {
    if (!node.isText) return;
    const has = node.marks.some(
      (mark) => mark.type.name === 'comment' && mark.attrs?.commentId === commentId,
    );
    if (has) {
      const nodeEnd = pos + node.nodeSize;
      if (from === null || pos < from) from = pos;
      if (to === null || nodeEnd > to) to = nodeEnd;
    }
  });

  if (from !== null && to !== null) return { from, to };
  return null;
}

/**
 * 해당 commentId 마크 위치로 에디터를 스크롤하고 선택한다.
 * @returns 이동 성공 여부(마크가 살아있으면 true)
 */
export function scrollToComment(editor: Editor, commentId: string): boolean {
  const range = findCommentRange(editor.state.doc, commentId);
  if (!range) return false;
  editor
    .chain()
    .focus()
    .setTextSelection(range)
    .scrollIntoView()
    .run();
  return true;
}

/**
 * 주어진 위치 범위 [from, to)와 겹치는 코멘트 마크의 commentId 목록을 수집한다.
 * Add-to-Chat 시 선택 범위에 걸린 코멘트를 함께 전달하기 위해 사용.
 *
 * @returns 문서 등장 순서대로 중복 제거된 commentId 배열
 */
export function collectCommentIdsInRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  doc.nodesBetween(from, to, (node: ProseMirrorNode): boolean | void => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name === 'comment') {
        const id = mark.attrs?.commentId;
        if (typeof id === 'string' && id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
  });

  return ids;
}

/**
 * DOM 클릭 이벤트 대상에서 가장 가까운 commentId를 찾는다.
 */
export function getCommentIdFromDomTarget(target: EventTarget | null): string | null {
  if (!target) return null;

  let el: Element | null = null;
  if (target instanceof Element) {
    el = target.closest('[data-comment-id]');
  } else if (target instanceof Node) {
    el = target.parentElement?.closest('[data-comment-id]') ?? null;
  }

  if (!el) return null;
  const id = el.getAttribute('data-comment-id');
  return typeof id === 'string' && id ? id : null;
}

/**
 * 해당 commentId 마크를 문서에서 제거한다(코멘트 삭제 시 마크 동시 제거용).
 * 마크가 이미 사라진 경우(고아)에도 안전하게 no-op.
 * @returns 마크를 제거했으면 true
 */
export function removeCommentMark(editor: Editor, commentId: string): boolean {
  const range = findCommentRange(editor.state.doc, commentId);
  if (!range) return false;
  editor
    .chain()
    .setTextSelection(range)
    .unsetComment()
    .run();
  return true;
}
