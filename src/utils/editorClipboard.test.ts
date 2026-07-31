import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  serializeSelectionForClipboard,
  writeRichClipboard,
} from './editorClipboard';

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
  });

  it('부분 선택의 블록 구조와 인라인 서식을 HTML과 Markdown으로 보존한다', () => {
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
    expect(result.markdown).toContain('## **굵은 글자**와 [링크](https://example.com) 뒷부분');
    expect(result.markdown).toContain('- 목록 항목');
  });

  it('HTML과 Markdown MIME을 하나의 ClipboardItem으로 기록한다', async () => {
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
      markdown: '**굵게**',
    });

    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]?.[0]?.[0] as ClipboardItemMock;
    expect(Object.keys(item.data)).toEqual(['text/html', 'text/plain']);
    expect(await readBlob(item.data['text/html']!)).toBe('<p><strong>굵게</strong></p>');
    expect(await readBlob(item.data['text/plain']!)).toBe('**굵게**');
  });
});
