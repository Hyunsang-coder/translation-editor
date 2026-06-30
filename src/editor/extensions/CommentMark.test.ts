import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { CommentMark } from './CommentMark';

function makeEditor() {
  return new Editor({
    extensions: [Document, Paragraph, Text, CommentMark],
  });
}

describe('CommentMark', () => {
  it('renders commentId into data-comment-id span', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>hello world</p>');
    // 전체 선택 후 마크 적용
    editor.commands.selectAll();
    editor.commands.setComment('cmt_123');

    const html = editor.getHTML();
    expect(html).toContain('data-comment-id="cmt_123"');
    expect(html).toContain('class="comment-mark"');
    editor.destroy();
  });

  it('round-trips: parse existing HTML preserves commentId', () => {
    const editor = makeEditor();
    editor.commands.setContent(
      '<p>before <span data-comment-id="cmt_abc">marked text</span> after</p>',
    );

    const html = editor.getHTML();
    expect(html).toContain('data-comment-id="cmt_abc"');
    expect(html).toContain('marked text');
    editor.destroy();
  });

  it('unsetComment removes the mark', () => {
    const editor = makeEditor();
    editor.commands.setContent(
      '<p><span data-comment-id="cmt_x">text</span></p>',
    );
    editor.commands.selectAll();
    editor.commands.unsetComment();

    expect(editor.getHTML()).not.toContain('data-comment-id');
    editor.destroy();
  });
});
