import { fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import type { Editor as ReactEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TipTapMenuBar } from './TipTapMenuBar';

const TABLE_HTML = `
  <table>
    <tbody>
      <tr><th>A</th><th>B</th></tr>
      <tr><td>1</td><td>2</td></tr>
    </tbody>
  </table>
  <p>바깥 문단</p>
`;

let editor: Editor | null = null;

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell],
    content,
  });
}

/** 문서에서 처음 나오는 셀 안으로 커서를 옮긴다. */
function placeCursorInFirstCell(target: Editor): void {
  let pos: number | null = null;
  target.state.doc.descendants((node, nodePos) => {
    if (pos !== null) return false;
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      pos = nodePos + 1;
      return false;
    }
    return true;
  });
  if (pos === null) throw new Error('셀을 찾지 못했습니다');
  target.commands.setTextSelection(pos);
}

function countRows(target: Editor): number {
  let rows = 0;
  target.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') rows += 1;
  });
  return rows;
}

function countCells(target: Editor): number {
  let cells = 0;
  target.state.doc.descendants((node) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells += 1;
  });
  return cells;
}

function openTableMenu(): void {
  fireEvent.click(screen.getByLabelText('표 행/열 편집'));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('TipTapMenuBar 표 행/열 편집', () => {
  it('커서가 표 밖에 있으면 버튼이 비활성화된다', () => {
    editor = createEditor('<p>표가 없는 문단</p>');
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    expect(screen.getByLabelText('표 행/열 편집')).toBeDisabled();
  });

  it('커서가 셀 안에 있으면 버튼이 활성화된다', () => {
    editor = createEditor(TABLE_HTML);
    placeCursorInFirstCell(editor);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    expect(screen.getByLabelText('표 행/열 편집')).toBeEnabled();
  });

  it('행을 추가하고 삭제한다', () => {
    editor = createEditor(TABLE_HTML);
    placeCursorInFirstCell(editor);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    expect(countRows(editor)).toBe(2);

    openTableMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '아래에 행 추가' }));
    expect(countRows(editor)).toBe(3);

    openTableMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '행 삭제' }));
    expect(countRows(editor)).toBe(2);
  });

  it('열을 추가하고 삭제한다', () => {
    editor = createEditor(TABLE_HTML);
    placeCursorInFirstCell(editor);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    expect(countCells(editor)).toBe(4);

    openTableMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '오른쪽에 열 추가' }));
    expect(countCells(editor)).toBe(6);

    openTableMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '열 삭제' }));
    expect(countCells(editor)).toBe(4);
  });

  it('명령 실행 후 메뉴가 닫힌다', () => {
    editor = createEditor(TABLE_HTML);
    placeCursorInFirstCell(editor);
    render(<TipTapMenuBar editor={editor as unknown as ReactEditor} panelType="source" />);

    openTableMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '위에 행 추가' }));

    expect(screen.queryByRole('menuitem', { name: '위에 행 추가' })).toBeNull();
  });
});
