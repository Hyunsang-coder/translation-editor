import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Slice } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { normalizeConfluencePastedSlice } from './pastedSliceNormalizer';

function sliceFromContent(content: Record<string, unknown>): Slice {
  const editor = new Editor({
    extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
    content,
  });
  return new Slice(editor.state.doc.content, 0, 0);
}

describe('normalizeConfluencePastedSlice', () => {
  it('코드 블록 앞뒤의 빈 문단을 제거한다', () => {
    const slice = sliceFromContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '기존 구조' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'codeBlock', content: [{ type: 'text', text: 'line 1\nline 2' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '다음 문단' }] },
      ],
    });

    const normalized = normalizeConfluencePastedSlice(slice);
    expect(normalized.content.toJSON().map((node: { type: string }) => node.type)).toEqual([
      'paragraph',
      'codeBlock',
      'paragraph',
    ]);
  });

  it('빈 문단 사이의 헤더 전용 복제 표를 제거한다', () => {
    const headerCells = ['위치/클래스', '종류', '상태', '역할'].map((text) => ({
      type: 'tableHeader',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }));
    const slice = sliceFromContent({
      type: 'doc',
      content: [
        { type: 'table', content: [{ type: 'tableRow', content: headerCells }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: headerCells },
            {
              type: 'tableRow',
              content: ['AHPlayerState', 'PlayerState', '확장', '보유 상태'].map((text) => ({
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
              })),
            },
          ],
        },
      ],
    });

    const normalized = normalizeConfluencePastedSlice(slice);
    const json = normalized.content.toJSON();
    expect(json).toHaveLength(1);
    expect(json[0]?.type).toBe('table');
    expect(json[0]?.content).toHaveLength(2);
  });
});
