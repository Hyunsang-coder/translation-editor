import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { CommentMark } from '@/editor/extensions/CommentMark';
import { findCommentRange, removeCommentMark } from './commentNavigation';

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
});
