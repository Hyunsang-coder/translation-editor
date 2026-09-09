import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { CellSelection } from '@tiptap/pm/tables';
import { writeHtml } from '@tauri-apps/plugin-clipboard-manager';
import { isTauriRuntime } from '@/tauri/invoke';
import {
  serializeSelectionForClipboard,
  writeRichClipboard,
} from './editorClipboard';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeHtml: vi.fn(),
}));

vi.mock('@/tauri/invoke', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

function findTextRange(editor: Editor, text: string): { from: number; to: number } {
  let result: { from: number; to: number } | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (result || !node.isText || !node.text) return;
    const offset = node.text.indexOf(text);
    if (offset === -1) return;
    result = {
      from: pos + offset,
      to: pos + offset + text.length,
    };
  });

  if (!result) {
    throw new Error(`텍스트를 찾지 못했습니다: ${text}`);
  }
  return result;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

describe('editorClipboard', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
    vi.restoreAllMocks();
    vi.mocked(isTauriRuntime).mockReturnValue(false);
  });

  it('부분 선택의 블록 구조는 HTML에, 읽을 수 있는 내용은 일반 텍스트에 보존한다', () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Link.configure({
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
        }),
      ],
      content: [
        '<h2>앞부분 <strong>굵은 글자</strong>와 ',
        '<a href="https://example.com">링크</a> 뒷부분</h2>',
        '<ul><li><p>목록 항목</p></li></ul>',
      ].join(''),
    });

    const start = findTextRange(editor, '굵은 글자').from;
    const end = findTextRange(editor, '목록 항목').to;
    editor.commands.setTextSelection({ from: start, to: end });

    const result = serializeSelectionForClipboard(
      editor,
      editor.state.selection.content(),
    );

    expect(result.html).toContain('<h2');
    expect(result.html).toContain('<strong>굵은 글자</strong>');
    expect(result.html).toContain('<a');
    expect(result.html).toContain('<ul');
    expect(result.text).toContain('굵은 글자와 링크 뒷부분');
    expect(result.text).toContain('목록 항목');
  });

  it('표 셀 선택의 일반 텍스트에는 HTML 태그를 넣지 않는다', () => {
    editor = new Editor({
      extensions: [StarterKit, Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
      content: '<table><tbody><tr><td><p>첫 셀</p></td><td><p>둘째 셀</p></td></tr></tbody></table>',
    });
    let cellPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos !== null) return false;
      if (node.type.name !== 'tableCell') return true;
      cellPos = pos;
      return false;
    });
    const selectedCellPos = cellPos;
    if (selectedCellPos === null) throw new Error('표 셀을 찾지 못했습니다.');
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, selectedCellPos)),
    );

    const result = serializeSelectionForClipboard(editor, editor.state.selection.content());

    expect(result.html).toContain('<table');
    expect(result.text).not.toContain('<table');
    expect(result.text).toContain('첫 셀');
  });

  it('HTML과 일반 텍스트 MIME을 하나의 ClipboardItem으로 기록한다', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });

    class ClipboardItemMock {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemMock);

    await writeRichClipboard({
      html: '<p><strong>굵게</strong></p>',
      text: '굵게',
    });

    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]?.[0]?.[0] as ClipboardItemMock;
    expect(Object.keys(item.data)).toEqual(['text/html', 'text/plain']);
    expect(await readBlob(item.data['text/html']!)).toBe('<p><strong>굵게</strong></p>');
    expect(await readBlob(item.data['text/plain']!)).toBe('굵게');
  });

  it('Tauri에서는 네이티브 HTML 클립보드를 사용한다', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(writeHtml).mockResolvedValue(undefined);

    await writeRichClipboard({ html: '<table><tr><td>셀</td></tr></table>', text: '셀' });

    expect(writeHtml).toHaveBeenCalledWith('<table><tr><td>셀</td></tr></table>', '셀');
  });
});
