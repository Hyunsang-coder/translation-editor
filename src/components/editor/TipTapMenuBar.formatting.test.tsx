import { fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import type { Editor as ReactEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TipTapMenuBar } from './TipTapMenuBar';

let editor: Editor | null = null;

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
    content,
  });
}

function openStyleMenu(): void {
  fireEvent.click(screen.getByLabelText('헤딩'));
}

function openFormatMenu(): void {
  fireEvent.click(screen.getByTestId('editor-menubar-format-source'));
}

function openListMenu(): void {
  fireEvent.click(screen.getByTestId('editor-menubar-list-source'));
}

function openViewSettings(): void {
  fireEvent.click(screen.getByTestId('editor-menubar-viewsettings-source'));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('TipTapMenuBar Confluence식 메뉴', () => {
  it('T 메뉴에서 인용 블록을 토글한다', () => {
    editor = createEditor('<p>hello</p>');
    editor.commands.setTextSelection(1);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openStyleMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '인용 블록' }));

    expect(editor.isActive('blockquote')).toBe(true);
  });

  it('T 메뉴에 단축키 칩이 표시된다', () => {
    editor = createEditor('<p>hello</p>');
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openStyleMenu();

    expect(screen.getByText('⌘⌥0')).toBeTruthy();
    expect(screen.getByText('⌘⌥1')).toBeTruthy();
  });

  it('B 메뉴에서 서식 지우기가 인라인 마크를 해제한다', () => {
    editor = createEditor('<p><strong>굵게</strong></p>');
    editor.commands.setTextSelection({ from: 1, to: 3 });
    expect(editor.isActive('bold')).toBe(true);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openFormatMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '서식 지우기' }));

    expect(editor.getHTML()).toBe('<p>굵게</p>');
  });

  it('B 메뉴에 단축키 칩이 표시된다', () => {
    editor = createEditor('<p>hello</p>');
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openFormatMenu();

    expect(screen.getByText('⌘B')).toBeTruthy();
    expect(screen.getByText('⌘E')).toBeTruthy();
    expect(screen.getByText('⌘⇧H')).toBeTruthy();
  });

  it('목록 메뉴에서 불릿·번호·작업 목록을 토글한다', () => {
    editor = createEditor('<p>hello</p>');
    editor.commands.setTextSelection(1);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openListMenu();
    expect(screen.getByText('⌘⇧8')).toBeTruthy();
    expect(screen.getByText('⌘⇧7')).toBeTruthy();
    expect(screen.getByText('⌘⇧9')).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: '작업 목록' }));
    expect(editor.isActive('taskList')).toBe(true);
  });

  it('목록 밖에서는 내어쓰기·들여쓰기가 비활성화된다', () => {
    editor = createEditor('<p>hello</p>');
    editor.commands.setTextSelection(1);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openListMenu();

    expect(screen.getByRole('menuitem', { name: '내어쓰기' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '들여쓰기' })).toBeDisabled();
  });

  it('보기 설정 메뉴에 글자 크기·줄 간격이 표시된다', () => {
    editor = createEditor('<p>hello</p>');
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openViewSettings();

    expect(screen.getByText('보기 설정')).toBeTruthy();
    expect(screen.getByText('글자 크기')).toBeTruthy();
    expect(screen.getByText('줄 간격')).toBeTruthy();
  });
});
