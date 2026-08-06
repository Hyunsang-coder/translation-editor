import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommentMark } from '@/editor/extensions/CommentMark';
import { useCommentStore } from '@/stores/commentStore';
import { syncCommentExcerpts } from './syncCommentExcerpts';

describe('syncCommentExcerpts', () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    useCommentStore.getState().clear();
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    useCommentStore.getState().clear();
  });

  it('마크가 가리키는 최신 텍스트로 comment excerpt를 갱신한다', () => {
    const comment = useCommentStore.getState().addComment({
      field: 'target',
      excerpt: '이전 번역',
      comment: '더 자연스럽게',
      createdAt: 1,
    });
    editor = new Editor({
      extensions: [StarterKit, CommentMark],
      content: `<p><span data-comment-id="${comment.id}">새 번역</span></p>`,
    });

    syncCommentExcerpts(editor, [comment.id]);

    expect(useCommentStore.getState().getComment(comment.id)?.excerpt).toBe('새 번역');
  });

  it('같은 commentId가 떨어진 범위에 있으면 줄바꿈으로 이어 저장한다', () => {
    const comment = useCommentStore.getState().addComment({
      field: 'target',
      excerpt: '이전',
      comment: '확인',
      createdAt: 2,
    });
    editor = new Editor({
      extensions: [StarterKit, CommentMark],
      content: [
        `<p><span data-comment-id="${comment.id}">첫 범위</span></p>`,
        `<p><span data-comment-id="${comment.id}">둘째 범위</span></p>`,
      ].join(''),
    });

    syncCommentExcerpts(editor, [comment.id]);

    expect(useCommentStore.getState().getComment(comment.id)?.excerpt).toBe('첫 범위\n둘째 범위');
  });

  it('마크가 사라진 commentId는 즉시 고아 코멘트에서 제거한다', () => {
    const comment = useCommentStore.getState().addComment({
      field: 'target',
      excerpt: '삭제됨',
      comment: '확인',
      createdAt: 3,
    });
    editor = new Editor({
      extensions: [StarterKit, CommentMark],
      content: '<p>마크 없음</p>',
    });

    syncCommentExcerpts(editor, [comment.id]);

    expect(useCommentStore.getState().getComment(comment.id)).toBeUndefined();
  });
});
