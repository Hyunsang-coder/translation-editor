import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import type { Editor as ReactEditor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TipTapMenuBar } from './TipTapMenuBar';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('TipTapMenuBar 링크·코멘트', () => {
  it('onAddComment가 없으면 코멘트 버튼을 숨긴다', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>hello</p>' });
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    expect(screen.queryByTestId('editor-menubar-comment-source')).toBeNull();
  });

  it('선택이 없으면 코멘트 버튼이 비활성화되고, 선택 후 클릭하면 핸들러가 호출된다', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>hello</p>' });
    const onAddComment = vi.fn();
    render(
      <TipTapMenuBar
        editor={editor as unknown as ReactEditor}
        panelType="source"
        onAddComment={onAddComment}
      />,
    );

    expect(screen.getByTestId('editor-menubar-comment-source')).toBeDisabled();

    act(() => {
      editor!.commands.setTextSelection({ from: 1, to: 3 });
    });
    fireEvent.click(screen.getByTestId('editor-menubar-comment-source'));
    expect(onAddComment).toHaveBeenCalledTimes(1);
  });

  it('Link extension이 없으면 링크 버튼을 숨긴다', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>hello</p>' });
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    expect(screen.queryByTestId('editor-menubar-link-source')).toBeNull();
  });

  it('링크 입력창에서 URL을 적용하고 해제한다', () => {
    editor = new Editor({
      extensions: [StarterKit, Link.configure({ openOnClick: false })],
      content: '<p>hello world</p>',
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    fireEvent.click(screen.getByTestId('editor-menubar-link-source'));
    const input = screen.getByTestId('editor-menubar-link-input-source');
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '적용' }));

    expect(editor.isActive('link')).toBe(true);
    expect(editor.getAttributes('link').href).toBe('https://example.com');

    fireEvent.click(screen.getByTestId('editor-menubar-link-source'));
    fireEvent.click(screen.getByRole('button', { name: '링크 해제' }));
    expect(editor.isActive('link')).toBe(false);
  });
});
