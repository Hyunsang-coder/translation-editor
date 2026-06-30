/**
 * CommentMark Extension
 * 사용자가 텍스트 범위에 남긴 인라인 코멘트를 시각화하고 위치를 추적하는 마크 확장.
 *
 * - 마크 attrs에는 `commentId`만 저장한다(긴 코멘트 본문은 commentStore에 별도 영속).
 * - `<span data-comment-id="...">`로 직렬화되어 SQLite `blocks.content` HTML에 자동 영속된다.
 * - Markdown 변환 경로에서는 소실되므로(AI엔 excerpt로 전달), `markdownConverter`에는
 *   schema 등록만 하고 Markdown 직렬화는 무시한다.
 */

import { Mark, mergeAttributes } from '@tiptap/core';

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      /** 선택 범위에 코멘트 마크 적용 */
      setComment: (commentId: string) => ReturnType;
      /** 코멘트 마크 제거 */
      unsetComment: () => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: 'comment',

  // 코멘트 마크는 inclusive=false: 마크 끝에서 타이핑해도 마크가 확장되지 않게
  inclusive: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
          if (!attributes.commentId) return {};
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'comment-mark',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) => {
          return commands.setMark(this.name, { commentId });
        },
      unsetComment:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
