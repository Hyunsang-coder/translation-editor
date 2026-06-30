import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { CommentMark } from '@/editor/extensions/CommentMark';
import { findCommentRange, removeCommentMark, collectCommentIdsInRange } from './commentNavigation';

function makeEditor(html: string) {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, CommentMark],
  });
  editor.commands.setContent(html);
  return editor;
}

describe('commentNavigation', () => {
  it('findCommentRange returns the span covering the marked text', () => {
    const editor = makeEditor(
      '<p>before <span data-comment-id="cmt_a">marked</span> after</p>',
    );
    const range = findCommentRange(editor.state.doc, 'cmt_a');
    expect(range).not.toBeNull();
    // 범위 내 텍스트가 마킹된 구절과 일치
    const text = editor.state.doc.textBetween(range!.from, range!.to);
    expect(text).toBe('marked');
    editor.destroy();
  });

  it('findCommentRange returns null for an orphan (missing) commentId', () => {
    const editor = makeEditor('<p>plain text</p>');
    expect(findCommentRange(editor.state.doc, 'cmt_missing')).toBeNull();
    editor.destroy();
  });

  it('removeCommentMark strips the mark and reports success', () => {
    const editor = makeEditor(
      '<p><span data-comment-id="cmt_b">text</span></p>',
    );
    const removed = removeCommentMark(editor, 'cmt_b');
    expect(removed).toBe(true);
    expect(editor.getHTML()).not.toContain('data-comment-id');
    editor.destroy();
  });

  it('removeCommentMark is a safe no-op for an orphan id', () => {
    const editor = makeEditor('<p>plain</p>');
    expect(removeCommentMark(editor, 'cmt_none')).toBe(false);
    editor.destroy();
  });

  it('collectCommentIdsInRange returns ids overlapping the range, deduped in order', () => {
    const editor = makeEditor(
      '<p><span data-comment-id="cmt_1">aa</span>bb<span data-comment-id="cmt_2">cc</span></p>',
    );
    // 문서 전체 범위
    const ids = collectCommentIdsInRange(editor.state.doc, 0, editor.state.doc.content.size);
    expect(ids).toEqual(['cmt_1', 'cmt_2']);
    editor.destroy();
  });

  it('collectCommentIdsInRange excludes marks outside the range', () => {
    const editor = makeEditor(
      '<p><span data-comment-id="cmt_1">aa</span>bb<span data-comment-id="cmt_2">cc</span></p>',
    );
    // 첫 마크 범위만 (cmt_1 = pos 1~3)
    const range = findCommentRange(editor.state.doc, 'cmt_1')!;
    const ids = collectCommentIdsInRange(editor.state.doc, range.from, range.to);
    expect(ids).toEqual(['cmt_1']);
    editor.destroy();
  });
});
