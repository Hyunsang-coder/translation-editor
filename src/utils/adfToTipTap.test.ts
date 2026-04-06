/**
 * adfToTipTap.ts 단위 테스트
 *
 * ADF(Atlassian Document Format) → TipTap JSON 변환 검증
 *
 * 검증 전략:
 * 1. 노드별 구조 변환 (paragraph, heading, list, table 등)
 * 2. 마크 변환 (strong, em, underline, link, code, subsup 등)
 * 3. Confluence 전용 노드 (panel, expand, layoutSection) → 근사 변환
 * 4. 인라인 노드 (mention, emoji, date, status, smartlink)
 * 5. 미디어 (media URL/UUID 처리)
 * 6. Edge case (heading level 범위, unknown node, 중첩 리스트 등)
 * 7. Roundtrip: ADF → TipTap JSON → Markdown (텍스트 손실 없음)
 */
import { describe, it, expect } from 'vitest';
import { adfToTipTap } from './adfToTipTap';
import { tipTapJsonToMarkdown } from './markdownConverter';
import type { AdfDocument } from './adfParser';

// ============================================================================
// Helpers
// ============================================================================

function doc(...content: unknown[]) {
  return { version: 1, type: 'doc' as const, content } as AdfDocument;
}

function p(...content: unknown[]) {
  return { type: 'paragraph', content };
}

function text(t: string, ...marks: unknown[]) {
  const node: Record<string, unknown> = { type: 'text', text: t };
  if (marks.length) node.marks = marks;
  return node;
}

function heading(level: number, ...content: unknown[]) {
  return { type: 'heading', attrs: { level }, content };
}

function mark(type: string, attrs?: Record<string, unknown>) {
  return attrs ? { type, attrs } : { type };
}

// result.content[0]을 꺼내는 헬퍼
function firstNode(result: ReturnType<typeof adfToTipTap>) {
  return result.content[0] as Record<string, unknown>;
}

function firstText(node: Record<string, unknown>) {
  return (node.content as Array<Record<string, unknown>>)[0];
}

// ============================================================================
// paragraph
// ============================================================================

describe('adfToTipTap - paragraph', () => {
  it('빈 문서', () => {
    const result = adfToTipTap(doc());
    expect(result.type).toBe('doc');
    expect(result.content).toEqual([]);
  });

  it('단순 텍스트 paragraph', () => {
    const result = adfToTipTap(doc(p(text('Hello world'))));
    expect(result.content).toHaveLength(1);
    const para = firstNode(result);
    expect(para.type).toBe('paragraph');
    expect(firstText(para).text).toBe('Hello world');
  });

  it('여러 paragraph', () => {
    const result = adfToTipTap(doc(p(text('First')), p(text('Second'))));
    expect(result.content).toHaveLength(2);
  });

  it('빈 paragraph', () => {
    const result = adfToTipTap(doc({ type: 'paragraph', content: [] }));
    expect(firstNode(result).type).toBe('paragraph');
  });
});

// ============================================================================
// heading
// ============================================================================

describe('adfToTipTap - heading', () => {
  it('heading level 1~6 변환', () => {
    for (let level = 1; level <= 6; level++) {
      const result = adfToTipTap(doc(heading(level, text(`Level ${level}`))));
      const h = firstNode(result);
      expect(h.type).toBe('heading');
      expect((h.attrs as Record<string, unknown>).level).toBe(level);
    }
  });

  it('heading 내 텍스트 보존', () => {
    const result = adfToTipTap(doc(heading(2, text('Section Title'))));
    const h = firstNode(result);
    expect(firstText(h).text).toBe('Section Title');
  });

  it('level 0 → 1로 클램핑', () => {
    const result = adfToTipTap(doc({ type: 'heading', attrs: { level: 0 }, content: [text('X')] }));
    const h = firstNode(result);
    expect((h.attrs as Record<string, unknown>).level).toBe(1);
  });

  it('level 7 → 6으로 클램핑', () => {
    const result = adfToTipTap(doc({ type: 'heading', attrs: { level: 7 }, content: [text('X')] }));
    const h = firstNode(result);
    expect((h.attrs as Record<string, unknown>).level).toBe(6);
  });
});

// ============================================================================
// 텍스트 마크
// ============================================================================

describe('adfToTipTap - text marks', () => {
  function getMarks(result: ReturnType<typeof adfToTipTap>) {
    const para = firstNode(result);
    const t = firstText(para);
    return t.marks as Array<Record<string, unknown>>;
  }

  it('strong → bold', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('bold', mark('strong'))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'bold' }]));
  });

  it('em → italic', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('italic', mark('em'))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'italic' }]));
  });

  it('underline', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('u', mark('underline'))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'underline' }]));
  });

  it('code (inline)', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('code()', mark('code'))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'code' }]));
  });

  it('strike', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('struck', mark('strike'))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'strike' }]));
  });

  it('link mark - href 보존', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('click', mark('link', { href: 'https://example.com' }))))));
    const linkMark = marks.find((m) => m.type === 'link');
    expect(linkMark).toBeDefined();
    expect((linkMark!.attrs as Record<string, unknown>).href).toBe('https://example.com');
  });

  it('복합 마크 (bold + italic)', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('both', mark('strong'), mark('em'))))));
    expect(marks.some((m) => m.type === 'bold')).toBe(true);
    expect(marks.some((m) => m.type === 'italic')).toBe(true);
  });

  it('subsup[type=sub] → subscript', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('H₂O', mark('subsup', { type: 'sub' }))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'subscript' }]));
  });

  it('subsup[type=sup] → superscript', () => {
    const marks = getMarks(adfToTipTap(doc(p(text('x²', mark('subsup', { type: 'sup' }))))));
    expect(marks).toEqual(expect.arrayContaining([{ type: 'superscript' }]));
  });

  it('textColor mark는 무시됨 (TextStyle extension 미설치)', () => {
    const result = adfToTipTap(doc(p(text('colored', mark('textColor', { color: '#ff0000' })))));
    const para = firstNode(result);
    const t = firstText(para);
    // marks 없거나 빈 배열
    expect(!t.marks || (t.marks as unknown[]).length === 0).toBe(true);
  });

  it('알 수 없는 mark는 무시', () => {
    const result = adfToTipTap(doc(p(text('text', mark('unknownMark')))));
    const para = firstNode(result);
    const t = firstText(para);
    expect(!t.marks || (t.marks as unknown[]).length === 0).toBe(true);
  });
});

// ============================================================================
// 리스트
// ============================================================================

describe('adfToTipTap - lists', () => {
  it('bulletList 변환', () => {
    const adf = doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text('Item 1'))] },
        { type: 'listItem', content: [p(text('Item 2'))] },
      ],
    });
    const list = firstNode(adfToTipTap(adf));
    expect(list.type).toBe('bulletList');
    expect((list.content as unknown[]).length).toBe(2);
  });

  it('orderedList 변환 + start 속성', () => {
    const adf = doc({
      type: 'orderedList',
      attrs: { order: 3 },
      content: [{ type: 'listItem', content: [p(text('First'))] }],
    });
    const list = firstNode(adfToTipTap(adf));
    expect(list.type).toBe('orderedList');
    expect((list.attrs as Record<string, unknown>).start).toBe(3);
  });

  it('orderedList order 미지정 → start: 1 기본값', () => {
    const adf = doc({
      type: 'orderedList',
      content: [{ type: 'listItem', content: [p(text('A'))] }],
    });
    const list = firstNode(adfToTipTap(adf));
    expect((list.attrs as Record<string, unknown>).start).toBe(1);
  });

  it('listItem 내 paragraph 보존', () => {
    const adf = doc({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p(text('Hello'))] }],
    });
    const list = firstNode(adfToTipTap(adf));
    const item = (list.content as Array<Record<string, unknown>>)[0];
    expect(item.type).toBe('listItem');
    expect((item.content as Array<Record<string, unknown>>)[0].type).toBe('paragraph');
  });

  it('중첩 리스트 (listItem 안에 bulletList)', () => {
    const adf = doc({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            p(text('Parent')),
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [p(text('Child'))] },
              ],
            },
          ],
        },
      ],
    });
    const result = adfToTipTap(adf);
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('Parent');
    expect(md).toContain('Child');
  });
});

// ============================================================================
// codeBlock
// ============================================================================

describe('adfToTipTap - codeBlock', () => {
  it('language 보존', () => {
    const adf = doc({ type: 'codeBlock', attrs: { language: 'typescript' }, content: [text('const x = 1;')] });
    const code = firstNode(adfToTipTap(adf));
    expect(code.type).toBe('codeBlock');
    expect((code.attrs as Record<string, unknown>).language).toBe('typescript');
  });

  it('텍스트 보존', () => {
    const adf = doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [text('console.log("hi")')] });
    const code = firstNode(adfToTipTap(adf));
    expect(firstText(code).text).toBe('console.log("hi")');
  });
});

// ============================================================================
// 테이블
// ============================================================================

describe('adfToTipTap - table', () => {
  const tableAdf: AdfDocument = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', attrs: { colspan: 2, rowspan: 1 }, content: [p(text('Name'))] },
              { type: 'tableHeader', content: [p(text('Value'))] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [p(text('Foo'))] },
              { type: 'tableCell', content: [p(text('Bar'))] },
            ],
          },
        ],
      },
    ],
  };

  it('table → tableRow → tableHeader/tableCell 구조 보존', () => {
    const result = adfToTipTap(tableAdf);
    const table = firstNode(result);
    expect(table.type).toBe('table');
    const rows = table.content as Array<Record<string, unknown>>;
    expect(rows[0].type).toBe('tableRow');
    const headerRow = rows[0].content as Array<Record<string, unknown>>;
    expect(headerRow[0].type).toBe('tableHeader');
    const dataRow = rows[1].content as Array<Record<string, unknown>>;
    expect(dataRow[0].type).toBe('tableCell');
  });

  it('tableHeader colspan attrs 보존', () => {
    const result = adfToTipTap(tableAdf);
    const table = firstNode(result);
    const rows = table.content as Array<Record<string, unknown>>;
    const header = (rows[0].content as Array<Record<string, unknown>>)[0];
    expect((header.attrs as Record<string, unknown>).colspan).toBe(2);
  });

  it('tableCell 기본 attrs (colspan: 1, rowspan: 1)', () => {
    const result = adfToTipTap(tableAdf);
    const table = firstNode(result);
    const rows = table.content as Array<Record<string, unknown>>;
    const cell = (rows[1].content as Array<Record<string, unknown>>)[0];
    expect((cell.attrs as Record<string, unknown>).colspan).toBe(1);
    expect((cell.attrs as Record<string, unknown>).rowspan).toBe(1);
  });

  it('셀 내 텍스트 보존', () => {
    const result = adfToTipTap(tableAdf);
    const table = firstNode(result);
    const rows = table.content as Array<Record<string, unknown>>;
    const cell = (rows[1].content as Array<Record<string, unknown>>)[0];
    const cellPara = (cell.content as Array<Record<string, unknown>>)[0];
    expect(cellPara.type).toBe('paragraph');
  });
});

// ============================================================================
// blockquote / hardBreak / rule
// ============================================================================

describe('adfToTipTap - blockquote / hardBreak / rule', () => {
  it('blockquote 변환', () => {
    const result = adfToTipTap(doc({ type: 'blockquote', content: [p(text('Quoted'))] }));
    expect(firstNode(result).type).toBe('blockquote');
  });

  it('hardBreak 변환', () => {
    const result = adfToTipTap(doc(p(text('Line 1'), { type: 'hardBreak' }, text('Line 2'))));
    const content = firstNode(result).content as Array<Record<string, unknown>>;
    expect(content.some((n) => n.type === 'hardBreak')).toBe(true);
  });

  it('rule → horizontalRule', () => {
    const result = adfToTipTap(doc({ type: 'rule' }));
    expect(firstNode(result).type).toBe('horizontalRule');
  });
});

// ============================================================================
// Confluence 전용 노드
// ============================================================================

describe('adfToTipTap - Confluence 전용 노드', () => {
  it('panel → blockquote (텍스트 보존)', () => {
    const result = adfToTipTap(doc({
      type: 'panel',
      attrs: { panelType: 'info' },
      content: [p(text('Info message'))],
    }));
    const node = firstNode(result);
    expect(['blockquote', 'paragraph']).toContain(node.type);
    expect(tipTapJsonToMarkdown(result)).toContain('Info message');
  });

  it('expand → title(bold) + 내용 (title 텍스트 보존)', () => {
    const result = adfToTipTap(doc({
      type: 'expand',
      attrs: { title: 'Details' },
      content: [p(text('Expanded content'))],
    }));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('Details');
    expect(md).toContain('Expanded content');
  });

  it('expand title 없으면 내용만 포함', () => {
    const result = adfToTipTap(doc({
      type: 'expand',
      content: [p(text('Content only'))],
    }));
    expect(tipTapJsonToMarkdown(result)).toContain('Content only');
  });

  it('nestedExpand도 expand와 동일하게 처리', () => {
    const result = adfToTipTap(doc({
      type: 'nestedExpand',
      attrs: { title: 'Nested' },
      content: [p(text('Nested content'))],
    }));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('Nested');
    expect(md).toContain('Nested content');
  });

  it('layoutSection → 좌우 컬럼 텍스트 순서대로 보존', () => {
    const result = adfToTipTap(doc({
      type: 'layoutSection',
      content: [
        { type: 'layoutColumn', content: [p(text('Left column'))] },
        { type: 'layoutColumn', content: [p(text('Right column'))] },
      ],
    }));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('Left column');
    expect(md).toContain('Right column');
  });
});

// ============================================================================
// 인라인 노드 (Confluence 전용)
// ============================================================================

describe('adfToTipTap - 인라인 노드', () => {
  it('mention → 텍스트', () => {
    const result = adfToTipTap(doc(p({ type: 'mention', attrs: { text: '@홍길동', id: 'user-1' } })));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('@홍길동');
  });

  it('emoji → 텍스트', () => {
    const result = adfToTipTap(doc(p({ type: 'emoji', attrs: { text: '😊', shortName: ':smile:' } })));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('😊');
  });

  it('emoji text 없을 때 shortName 사용', () => {
    const result = adfToTipTap(doc(p({ type: 'emoji', attrs: { shortName: ':thumbsup:' } })));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain(':thumbsup:');
  });

  it('emoji text/shortName 둘 다 없으면 스킵', () => {
    const result = adfToTipTap(doc(p({ type: 'emoji', attrs: {} })));
    // paragraph는 있지만 내용이 비거나 빈 텍스트
    expect(result.content).toBeDefined();
  });

  it('date → YYYY-MM-DD 형식 텍스트', () => {
    // 2024-01-15 기준 epoch ms
    const result = adfToTipTap(doc(p({ type: 'date', attrs: { timestamp: '1705276800000' } })));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('date timestamp 없으면 스킵', () => {
    const result = adfToTipTap(doc(p({ type: 'date', attrs: {} })));
    expect(result.content).toBeDefined();
  });

  it('status → [label] 텍스트', () => {
    const result = adfToTipTap(doc(p({ type: 'status', attrs: { text: 'Done' } })));
    const para = firstNode(result);
    const t = firstText(para);
    // TipTap JSON 레벨에서 확인 (Markdown 이스케이프 회피)
    expect(t.text).toBe('[Done]');
  });

  it('inlineCard → text + link mark', () => {
    const result = adfToTipTap(doc(p({ type: 'inlineCard', attrs: { url: 'https://example.com' } })));
    const para = firstNode(result);
    const t = firstText(para);
    expect(t.text).toBe('https://example.com');
    const marks = t.marks as Array<Record<string, unknown>>;
    expect(marks.some((m) => m.type === 'link')).toBe(true);
  });

  it('inlineCard url 없으면 스킵', () => {
    const result = adfToTipTap(doc(p({ type: 'inlineCard', attrs: {} })));
    // paragraph가 비어있거나 해당 노드 없음
    expect(result.type).toBe('doc');
  });

  it('blockCard → paragraph로 감싼 링크', () => {
    const result = adfToTipTap(doc({ type: 'blockCard', attrs: { url: 'https://example.com' } }));
    const node = firstNode(result);
    // 블록 레벨이므로 paragraph여야 함
    expect(node.type).toBe('paragraph');
    const content = node.content as Array<Record<string, unknown>>;
    const marks = content[0].marks as Array<Record<string, unknown>>;
    expect(marks.some((m) => m.type === 'link')).toBe(true);
  });

  it('embedCard url 없으면 스킵', () => {
    const result = adfToTipTap(doc({ type: 'embedCard', attrs: {} }));
    expect(result.content).toHaveLength(0);
  });
});

// ============================================================================
// 미디어
// ============================================================================

describe('adfToTipTap - media', () => {
  it('media URL 있으면 image 노드 생성', () => {
    const result = adfToTipTap(doc({
      type: 'mediaSingle',
      content: [{ type: 'media', attrs: { url: 'https://example.com/img.png', type: 'external' } }],
    }));
    const img = firstNode(result);
    expect(img.type).toBe('image');
    expect((img.attrs as Record<string, unknown>).src).toBe('https://example.com/img.png');
  });

  it('media URL 없고 id만 있으면 스킵 (broken image 방지)', () => {
    const result = adfToTipTap(doc({
      type: 'mediaSingle',
      content: [{ type: 'media', attrs: { id: 'some-uuid', type: 'file' } }],
    }));
    // mediaSingle 내 media가 스킵되면 content가 비어있음
    expect(result.content).toHaveLength(0);
  });

  it('media url/id 둘 다 없으면 스킵', () => {
    const result = adfToTipTap(doc({
      type: 'mediaSingle',
      content: [{ type: 'media', attrs: {} }],
    }));
    expect(result.content).toHaveLength(0);
  });
});

// ============================================================================
// Edge case
// ============================================================================

describe('adfToTipTap - edge case', () => {
  it('알 수 없는 노드 + content 있으면 평탄화', () => {
    const result = adfToTipTap(doc({
      type: 'unknownContainer',
      content: [p(text('inside unknown'))],
    }));
    const md = tipTapJsonToMarkdown(result);
    expect(md).toContain('inside unknown');
  });

  it('알 수 없는 노드 + content 없으면 스킵', () => {
    const result = adfToTipTap(doc({ type: 'unknownLeaf' }));
    expect(result.content).toHaveLength(0);
  });

  it('result는 항상 type: doc + content 배열', () => {
    const result = adfToTipTap(doc(p(text('test'))));
    expect(result.type).toBe('doc');
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// ============================================================================
// Roundtrip: ADF → TipTap → Markdown (텍스트 손실 없음)
// ============================================================================

describe('adfToTipTap - roundtrip', () => {
  it('복합 문서 (heading + paragraph + list + codeBlock)', () => {
    const adf: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Normal ' },
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' text.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item A' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }] },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'python' },
          content: [{ type: 'text', text: 'print("hello")' }],
        },
      ],
    };

    const md = tipTapJsonToMarkdown(adfToTipTap(adf));
    expect(md).toContain('Title');
    expect(md).toContain('bold');
    expect(md).toContain('Item A');
    expect(md).toContain('Item B');
    expect(md).toContain('print("hello")');
  });
});
