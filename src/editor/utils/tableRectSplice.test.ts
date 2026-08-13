import { describe, expect, it } from 'vitest';
import {
  tipTapJsonToMarkdownForTranslation,
  type TipTapDocJson,
} from '@/utils/markdownConverter';
import {
  TableStructureMismatchError,
  extractBlockDoc,
  extractTableRectDoc,
  replaceBlockAtPath,
  replaceTableRect,
} from './tableRectSplice';

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
}

function cell(text: string, id: string, type = 'tableCell'): JsonNode {
  return {
    type,
    attrs: { translationUnitId: id, colspan: 1, rowspan: 1 },
    content: [
      {
        type: 'paragraph',
        attrs: { translationUnitId: `${id}-p` },
        content: [{ type: 'text', text }],
      },
    ],
  };
}

/** 2행 3열 표 + 앞뒤 문단 */
function makeDoc(): TipTapDocJson {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { translationUnitId: 'intro' }, content: [{ type: 'text', text: 'Intro' }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('A1', 'a1'), cell('B1', 'b1'), cell('C1', 'c1')] },
          { type: 'tableRow', content: [cell('A2', 'a2'), cell('B2', 'b2'), cell('C2', 'c2')] },
        ],
      },
      { type: 'paragraph', attrs: { translationUnitId: 'outro' }, content: [{ type: 'text', text: 'Outro' }] },
    ],
  } as TipTapDocJson;
}

function cellTexts(doc: TipTapDocJson): string[][] {
  const table = (doc as JsonNode).content?.[1];
  return (table?.content ?? []).map((row) =>
    (row.content ?? []).map((c) => c.content?.[0]?.content?.[0]?.text ?? ''),
  );
}

const MIDDLE_COLUMN = { top: 0, left: 1, bottom: 2, right: 2 };

describe('extractTableRectDoc', () => {
  it('가운데 열만 떼어 2×1 표를 만든다', () => {
    const extracted = extractTableRectDoc(makeDoc(), 1, MIDDLE_COLUMN);

    expect((extracted as JsonNode).content).toHaveLength(1);
    const table = (extracted as JsonNode).content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content).toHaveLength(2);
    expect((table?.content ?? []).map((row) => row.content?.length)).toEqual([1, 1]);
    expect(
      (table?.content ?? []).map((row) => row.content?.[0]?.content?.[0]?.content?.[0]?.text),
    ).toEqual(['B1', 'B2']);
  });

  it('모델에 보내는 payload에 고르지 않은 셀이 들어가지 않는다', () => {
    const markdown = tipTapJsonToMarkdownForTranslation(
      extractTableRectDoc(makeDoc(), 1, MIDDLE_COLUMN),
    );

    expect(markdown).toContain('B1');
    expect(markdown).toContain('B2');
    for (const other of ['A1', 'C1', 'A2', 'C2', 'Intro', 'Outro']) {
      expect(markdown).not.toContain(other);
    }
  });

  it('표 밖 사각형은 던진다', () => {
    expect(() => extractTableRectDoc(makeDoc(), 1, { top: 0, left: 2, bottom: 2, right: 4 }))
      .toThrow(/사각형이 표 밖/);
  });

  it('표가 아닌 블록 인덱스는 던진다', () => {
    expect(() => extractTableRectDoc(makeDoc(), 0, MIDDLE_COLUMN)).toThrow(/표가 아닙니다/);
  });

  it('병합 셀이 있는 표는 던진다', () => {
    const doc = makeDoc() as JsonNode;
    const merged = doc.content?.[1]?.content?.[0]?.content?.[0];
    merged!.attrs = { ...merged!.attrs, colspan: 2 };

    expect(() => extractTableRectDoc(doc as TipTapDocJson, 1, MIDDLE_COLUMN))
      .toThrow(/병합 셀/);
  });
});

describe('replaceTableRect', () => {
  it('가운데 열만 바꾸고 나머지 셀·문단은 그대로 둔다', () => {
    const original = makeDoc();
    const extracted = extractTableRectDoc(original, 1, MIDDLE_COLUMN) as JsonNode;
    // 모델이 셀 텍스트를 다듬고 attrs(translationUnitId)는 버린 상황
    extracted.content![0]!.content = extracted.content![0]!.content!.map((_row, index) => ({
      type: 'tableRow',
      content: [
        {
          type: 'tableCell',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `다듬음${index}` }] }],
        },
      ],
    }));

    const merged = replaceTableRect(original, 1, MIDDLE_COLUMN, extracted as TipTapDocJson);

    expect(cellTexts(merged)).toEqual([
      ['A1', '다듬음0', 'C1'],
      ['A2', '다듬음1', 'C2'],
    ]);
    // 표 밖 문단은 그대로 (객체 정체성까지)
    expect((merged as JsonNode).content?.[0]).toBe((original as JsonNode).content?.[0]);
    expect((merged as JsonNode).content?.[2]).toBe((original as JsonNode).content?.[2]);
    // 입력 불변
    expect(cellTexts(original)).toEqual([
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
    ]);
  });

  it('셀 attrs(translationUnitId)는 원본을 유지하고 내용만 갈아끼운다', () => {
    const original = makeDoc();
    const replacement = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [0, 1].map(() => ({
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { translationUnitId: 'MODEL-INVENTED' },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'X' }] }],
              },
            ],
          })),
        },
      ],
    } as TipTapDocJson;

    const merged = replaceTableRect(original, 1, MIDDLE_COLUMN, replacement) as JsonNode;
    const changed = merged.content?.[1]?.content?.[0]?.content?.[1];

    expect(changed?.attrs?.translationUnitId).toBe('b1');
    expect(changed?.content?.[0]?.content?.[0]?.text).toBe('X');
  });

  it('결과 표의 행 수가 다르면 던진다', () => {
    const replacement = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'only' }] }] },
              ],
            },
          ],
        },
      ],
    } as TipTapDocJson;

    expect(() => replaceTableRect(makeDoc(), 1, MIDDLE_COLUMN, replacement))
      .toThrow(TableStructureMismatchError);
  });

  it('결과 표의 열 수가 다르면 던진다', () => {
    const replacement = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [0, 1].map(() => ({
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
            ],
          })),
        },
      ],
    } as TipTapDocJson;

    expect(() => replaceTableRect(makeDoc(), 1, MIDDLE_COLUMN, replacement))
      .toThrow(TableStructureMismatchError);
  });

  it('헤더 셀은 결과가 일반 셀이어도 헤더 타입을 유지한다', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('H1', 'h1', 'tableHeader'), cell('H2', 'h2', 'tableHeader')] },
            { type: 'tableRow', content: [cell('A1', 'a1'), cell('B1', 'b1')] },
          ],
        },
      ],
    } as TipTapDocJson;
    const replacement = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [0, 1].map((rowIndex) => ({
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: `r${rowIndex}` }] }],
              },
            ],
          })),
        },
      ],
    } as TipTapDocJson;

    const merged = replaceTableRect(doc, 0, { top: 0, left: 0, bottom: 2, right: 1 }, replacement) as JsonNode;
    const rows = merged.content?.[0]?.content ?? [];

    expect(rows[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(rows[1]?.content?.[0]?.type).toBe('tableCell');
    expect(rows[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('r0');
  });
});

describe('extractBlockDoc / replaceBlockAtPath', () => {
  const BLOCK_PATH = [1, 1, 1, 0]; // 표 → 2행 → 2열 셀 → 첫 문단

  it('셀 안 문단 하나만 담은 문서를 만든다', () => {
    const extracted = extractBlockDoc(makeDoc(), BLOCK_PATH) as JsonNode;

    expect(extracted.content).toHaveLength(1);
    expect(extracted.content?.[0]?.type).toBe('paragraph');
    expect(extracted.content?.[0]?.content?.[0]?.text).toBe('B2');
  });

  it('그 문단만 바꾸고 같은 셀의 다른 내용·옆 셀은 그대로 둔다', () => {
    const original = makeDoc();
    const replacement = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '다듬은 B2' }] }],
    } as TipTapDocJson;

    const merged = replaceBlockAtPath(original, BLOCK_PATH, replacement);

    expect(cellTexts(merged)).toEqual([
      ['A1', 'B1', 'C1'],
      ['A2', '다듬은 B2', 'C2'],
    ]);
    // 문단 attrs(translationUnitId)는 유지
    const block = (merged as JsonNode).content?.[1]?.content?.[1]?.content?.[1]?.content?.[0];
    expect(block?.attrs?.translationUnitId).toBe('b2-p');
    expect(cellTexts(original)).toEqual([
      ['A1', 'B1', 'C1'],
      ['A2', 'B2', 'C2'],
    ]);
  });

  it('결과 블록이 여러 개면 던진다', () => {
    const replacement = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '앞' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '뒤' }] },
      ],
    } as TipTapDocJson;

    expect(() => replaceBlockAtPath(makeDoc(), BLOCK_PATH, replacement))
      .toThrow(TableStructureMismatchError);
  });
});
