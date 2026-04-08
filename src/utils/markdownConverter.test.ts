/**
 * markdownConverter HTML 테이블 처리 테스트
 *
 * 테스트 목적:
 * 1. 기존 함수(html: false)의 동작 확인
 * 2. 번역 전용 함수(html: true)의 동작 확인
 * 3. 역변환 안전성 검증
 */
import { describe, it, expect } from 'vitest';
import {
  markdownToTipTapJson,
  tipTapJsonToMarkdown,
  tipTapJsonToMarkdownForTranslation,
  markdownToTipTapJsonForTranslation,
  htmlToTipTapJson,
  fixMisalignedBoldMarks,
  parseTranslationResponseToTipTap,
} from './markdownConverter';

describe('markdownConverter - 기존 함수 (html: false)', () => {
  it('Markdown 테이블이 올바르게 파싱되어야 함', () => {
    const mdTable = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;

    const json = markdownToTipTapJson(mdTable);

    console.warn('Markdown table JSON:', JSON.stringify(json, null, 2));

    expect(json.type).toBe('doc');
    const tableNode = (json.content as unknown[]).find(
      (node: unknown) => (node as { type?: string }).type === 'table'
    );
    expect(tableNode).toBeDefined();
  });

  it('html: false에서 HTML 테이블은 텍스트로 처리됨 (의도된 동작)', () => {
    // html: false 설정에서는 HTML이 그대로 텍스트로 출력됨
    // 이는 Chat, Review 등에서 HTML 주입을 방지하기 위한 의도된 동작
    const htmlTable = `<table><tr><th>Header</th></tr></table>`;
    const json = markdownToTipTapJson(htmlTable);

    expect(json.type).toBe('doc');
    // HTML이 텍스트로 처리되므로 table 노드가 아닌 paragraph로 변환
    const tableNode = (json.content as unknown[]).find(
      (node: unknown) => (node as { type?: string }).type === 'table'
    );
    expect(tableNode).toBeUndefined(); // 의도적으로 파싱 안됨
  });

  it('TipTap JSON (복잡한 테이블) → Markdown 변환 시 [table] 플레이스홀더가 나와야 함 (현재 동작)', () => {
    // 셀에 리스트가 있는 복잡한 테이블 JSON
    const complexTableJson = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Header' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = tipTapJsonToMarkdown(complexTableJson);

    console.warn('Complex table to Markdown:', markdown);

    // 현재 html: false이므로 [table]로 변환됨
    expect(markdown).toContain('[table]');
  });

  it('TipTap JSON (단순 테이블) → Markdown 변환 시 Markdown 테이블 형식이어야 함', () => {
    // 단순 테이블 (각 셀에 단일 paragraph만)
    const simpleTableJson = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Header 1' }] },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Header 2' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Cell 1' }] },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Cell 2' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = tipTapJsonToMarkdown(simpleTableJson);

    console.warn('Simple table to Markdown:', markdown);

    // 단순 테이블은 Markdown 테이블로 변환되어야 함
    expect(markdown).toContain('|');
    expect(markdown).toContain('Header 1');
    expect(markdown).not.toContain('[table]');
  });
});

describe('markdownConverter - 번역 전용 함수 (html: true)', () => {
  it('tipTapJsonToMarkdownForTranslation: 복잡한 테이블이 HTML로 변환되어야 함', () => {
    // 셀에 여러 paragraph가 있는 복잡한 테이블
    const complexTableJson = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Header' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = tipTapJsonToMarkdownForTranslation(complexTableJson);

    console.warn('ForTranslation - Complex table:', markdown);

    // HTML 테이블로 변환되어야 함 (not [table])
    // TipTap은 style 속성을 포함한 <table style="..."> 형태로 출력
    expect(markdown).toContain('<table');
    expect(markdown).toContain('Header');
    expect(markdown).toContain('Line 1');
    expect(markdown).toContain('Line 2');
    expect(markdown).not.toContain('[table]');
  });

  it('parseTranslationResponseToTipTap: AI가 HTML(ul/li) 반환 시 raw HTML 그대로 표시되지 않고 파싱되어야 함', () => {
    const htmlList = '<ul><li><p>Regarding performance, you just need to meet the console criteria we proposed.</p></li><li><p>2025-10-23 Weekly Meeting</p></li></ul>';
    const json = parseTranslationResponseToTipTap(htmlList);

    expect(json.type).toBe('doc');
    const jsonStr = JSON.stringify(json);
    // raw HTML이 그대로 나오면 안 됨 (문제의 원인)
    expect(jsonStr).not.toContain('<ul>');
    expect(jsonStr).not.toContain('<li>');
    // 텍스트 내용은 보존되어야 함
    expect(jsonStr).toContain('Regarding performance');
    expect(jsonStr).toContain('2025-10-23 Weekly Meeting');
  });

  it('parseTranslationResponseToTipTap: 마크다운이면 markdownToTipTapJsonForTranslation과 동일하게 동작', () => {
    const markdown = '- Item 1\n- Item 2';
    const json = parseTranslationResponseToTipTap(markdown);

    expect(json.type).toBe('doc');
    const bulletList = (json.content as unknown[]).find(
      (node: unknown) => (node as { type?: string }).type === 'bulletList'
    );
    expect(bulletList).toBeDefined();
    expect(JSON.stringify(json)).toContain('Item 1');
  });

  it('markdownToTipTapJsonForTranslation: HTML 테이블이 TipTap JSON으로 파싱되어야 함', () => {
    const htmlTable = `<table>
      <tr><th>Header 1</th><th>Header 2</th></tr>
      <tr><td>Cell 1</td><td>Cell 2</td></tr>
    </table>`;

    const json = markdownToTipTapJsonForTranslation(htmlTable);

    console.warn('ForTranslation - HTML to JSON:', JSON.stringify(json, null, 2));

    expect(json.type).toBe('doc');
    const tableNode = (json.content as unknown[]).find(
      (node: unknown) => (node as { type?: string }).type === 'table'
    );
    expect(tableNode).toBeDefined();
  });

  it('번역 전용 함수 왕복 테스트: JSON → HTML → JSON', () => {
    const originalJson = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Work' }] },
                  ],
                },
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Estimation' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'LA-Building' }] },
                  ],
                },
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '1850 md' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // JSON → Markdown (HTML 형식)
    const markdown = tipTapJsonToMarkdownForTranslation(originalJson);
    console.warn('Roundtrip - Markdown:', markdown);

    // Markdown (HTML) → JSON
    const restoredJson = markdownToTipTapJsonForTranslation(markdown);
    console.warn('Roundtrip - Restored JSON:', JSON.stringify(restoredJson, null, 2));

    // 테이블 구조가 보존되어야 함
    expect(restoredJson.type).toBe('doc');
    const tableNode = (restoredJson.content as unknown[]).find(
      (node: unknown) => (node as { type?: string }).type === 'table'
    );
    expect(tableNode).toBeDefined();

    // 텍스트 내용 확인
    const jsonStr = JSON.stringify(restoredJson);
    expect(jsonStr).toContain('Work');
    expect(jsonStr).toContain('Estimation');
    expect(jsonStr).toContain('LA-Building');
    expect(jsonStr).toContain('1850 md');
  });

  it('기존 함수는 영향받지 않아야 함 (html: false 유지)', () => {
    const complexTableJson = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Header' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // 기존 함수는 [table]로 변환 (기존 동작 유지)
    const markdown = tipTapJsonToMarkdown(complexTableJson);
    expect(markdown).toContain('[table]');
  });
});

describe('markdownConverter - 검수(Review) 파이프라인 시나리오', () => {
  it('htmlToTipTapJson + tipTapJsonToMarkdownForTranslation: 복잡한 테이블 HTML이 검수에서 보존되어야 함', () => {
    // 검수 청킹에서 사용하는 변환 체인 테스트
    // HTML → TipTap JSON → Markdown (with HTML tables)
    const htmlWithComplexTable = `
      <table>
        <tr>
          <th><p>작업 항목</p></th>
          <th><p>예상 공수</p></th>
        </tr>
        <tr>
          <td>
            <p>LA-Building 구현</p>
            <ul><li>서버 설정</li><li>클라이언트 구현</li></ul>
          </td>
          <td><p>1850 md</p></td>
        </tr>
      </table>
    `;

    // Step 1: HTML → TipTap JSON
    const json = htmlToTipTapJson(htmlWithComplexTable);
    expect(json.type).toBe('doc');

    // Step 2: TipTap JSON → Markdown (번역용, HTML 테이블 보존)
    const markdown = tipTapJsonToMarkdownForTranslation(json);

    console.warn('Review pipeline - Markdown output:', markdown);

    // 테이블이 HTML로 보존되어야 함 (NOT [table])
    expect(markdown).toContain('<table');
    expect(markdown).not.toContain('[table]');

    // 모든 텍스트 내용이 보존되어야 함
    expect(markdown).toContain('작업 항목');
    expect(markdown).toContain('예상 공수');
    expect(markdown).toContain('LA-Building');
    expect(markdown).toContain('서버 설정');
    expect(markdown).toContain('클라이언트 구현');
    expect(markdown).toContain('1850 md');
  });

  it('셀 내 리스트가 있는 테이블도 검수용 변환에서 내용이 보존되어야 함', () => {
    const tableWithList = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '할 일' }] },
                    {
                      type: 'bulletList',
                      content: [
                        {
                          type: 'listItem',
                          content: [
                            { type: 'paragraph', content: [{ type: 'text', text: '항목 A' }] },
                          ],
                        },
                        {
                          type: 'listItem',
                          content: [
                            { type: 'paragraph', content: [{ type: 'text', text: '항목 B' }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = tipTapJsonToMarkdownForTranslation(tableWithList);

    console.warn('Table with list - Markdown output:', markdown);

    // HTML 테이블로 변환되어야 함
    expect(markdown).toContain('<table');
    expect(markdown).not.toContain('[table]');

    // 모든 내용 보존
    expect(markdown).toContain('할 일');
    expect(markdown).toContain('항목 A');
    expect(markdown).toContain('항목 B');
  });
});

describe('parseTranslationResponseToTipTap - 테이블 내 리스트 보존', () => {
  it('HTML 테이블 셀 안의 bulletList 구조가 보존되어야 함', () => {
    const input = `<table>
      <tr><th><p>Header</p></th></tr>
      <tr><td><p>Intro</p><ul><li><p>Item A</p></li><li><p>Item B</p></li></ul></td></tr>
    </table>`;
    const json = parseTranslationResponseToTipTap(input);
    const jsonStr = JSON.stringify(json);

    expect(jsonStr).toContain('"type":"table"');
    expect(jsonStr).toContain('"type":"bulletList"');
    expect(jsonStr).toContain('Item A');
    expect(jsonStr).toContain('Item B');
  });

  it('HTML 테이블 셀 안의 orderedList 구조가 보존되어야 함', () => {
    const input = `<table>
      <tr><td><ol><li><p>Step 1</p></li><li><p>Step 2</p></li></ol></td></tr>
    </table>`;
    const json = parseTranslationResponseToTipTap(input);
    const jsonStr = JSON.stringify(json);

    expect(jsonStr).toContain('"type":"orderedList"');
    expect(jsonStr).toContain('Step 1');
    expect(jsonStr).toContain('Step 2');
  });

  it('Markdown + HTML 테이블 혼합 콘텐츠에서 양쪽 모두 올바르게 파싱', () => {
    const input = `# Title\n\nSome paragraph.\n\n<table><tr><td><ul><li><p>A</p></li></ul></td></tr></table>\n\n## Next section`;
    const json = parseTranslationResponseToTipTap(input);
    const jsonStr = JSON.stringify(json);

    expect(jsonStr).toContain('"type":"heading"');
    expect(jsonStr).toContain('"type":"table"');
    expect(jsonStr).toContain('"type":"bulletList"');
    expect(jsonStr).toContain('Next section');
  });

  it('테이블이 없는 콘텐츠는 기존 동작 유지 (fast path)', () => {
    const input = '# Hello\n\nWorld';
    const json = parseTranslationResponseToTipTap(input);
    expect(json.type).toBe('doc');
    const jsonStr = JSON.stringify(json);
    expect(jsonStr).toContain('Hello');
    expect(jsonStr).toContain('World');
    expect(jsonStr).not.toContain('"type":"table"');
  });

  it('라운드트립: 셀 내 리스트가 있는 TipTap JSON → Markdown → 파싱 후 리스트 보존', () => {
    const original = {
      type: 'doc',
      content: [{
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [{
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Tasks' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task A' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task B' }] }] },
              ]},
            ],
          }],
        }],
      }],
    };

    // TipTap JSON → HTML+Markdown (이 단계는 정상 동작)
    const markdown = tipTapJsonToMarkdownForTranslation(original);
    expect(markdown).toContain('<table');

    // HTML+Markdown → TipTap JSON (이 단계에서 리스트가 깨졌던 버그)
    const restored = parseTranslationResponseToTipTap(markdown);
    const restoredStr = JSON.stringify(restored);

    expect(restoredStr).toContain('"type":"table"');
    expect(restoredStr).toContain('"type":"bulletList"');
    expect(restoredStr).toContain('Task A');
    expect(restoredStr).toContain('Task B');
  });

  it('여러 테이블이 Markdown 사이에 있는 경우 모두 올바르게 파싱', () => {
    const input = `# Section 1\n\n<table><tr><td><ul><li><p>List 1</p></li></ul></td></tr></table>\n\nMiddle text\n\n<table><tr><td><ul><li><p>List 2</p></li></ul></td></tr></table>\n\n# Section 2`;
    const json = parseTranslationResponseToTipTap(input);
    const jsonStr = JSON.stringify(json);

    expect(jsonStr).toContain('Section 1');
    expect(jsonStr).toContain('List 1');
    expect(jsonStr).toContain('Middle text');
    expect(jsonStr).toContain('List 2');
    expect(jsonStr).toContain('Section 2');
    // 테이블 2개 존재
    expect((jsonStr.match(/"type":"table"/g) || []).length).toBe(2);
  });

  it('리스트 없는 단순 HTML 테이블도 정상 파싱 (회귀 테스트)', () => {
    const input = `<table><tr><th><p>H1</p></th><th><p>H2</p></th></tr><tr><td><p>C1</p></td><td><p>C2</p></td></tr></table>`;
    const json = parseTranslationResponseToTipTap(input);
    const jsonStr = JSON.stringify(json);

    expect(jsonStr).toContain('"type":"table"');
    expect(jsonStr).toContain('H1');
    expect(jsonStr).toContain('C2');
  });

  it('colspan/rowspan이 있는 테이블도 보존', () => {
    const input = `<table><tr><td colspan="2" rowspan="1"><p>Merged</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>`;
    const json = parseTranslationResponseToTipTap(input);
    const jsonStr = JSON.stringify(json);

    expect(jsonStr).toContain('"type":"table"');
    expect(jsonStr).toContain('Merged');
    expect(jsonStr).toContain('"colspan":2');
  });
});

describe('fixMisalignedBoldMarks - LLM 볼드 마크 경계 보정', () => {
  // 패턴 1: 닫는 ** 뒤에 이어지는 단어문자를 mark 안으로
  it('**partial**rest → **partial rest** (닫는 ** 뒤 이어지는 단어)', () => {
    expect(fixMisalignedBoldMarks('**Two typ**es')).toBe('**Two types**');
    expect(fixMisalignedBoldMarks('**default s**etting')).toBe('**default setting**');
  });

  // 패턴 2: 여는 ** 앞에 이어지는 단어문자를 mark 안으로
  it('prefix**partial** → **prefix partial** (여는 ** 앞 이어지는 단어)', () => {
    expect(fixMisalignedBoldMarks('i**n the ne**w')).toBe('**in the new**');
    expect(fixMisalignedBoldMarks('Th**is is bold**')).toBe('**This is bold**');
  });

  // 패턴 3: mark 안 앞뒤 공백을 mark 밖으로
  it('** text ** → **text** (mark 안 앞뒤 공백을 밖으로)', () => {
    expect(fixMisalignedBoldMarks('** be **')).toBe(' **be** ');
    expect(fixMisalignedBoldMarks('word ** bold ** end')).toBe('word **bold** end');
  });

  // 패턴 1+2 복합
  it('prefix**partial**rest → **prefix partial rest** (양쪽 모두)', () => {
    expect(fixMisalignedBoldMarks('i**n the ne**w')).toBe('**in the new**');
  });

  // CJK 문자 지원
  it('CJK 문자도 처리', () => {
    expect(fixMisalignedBoldMarks('**기본 설**정')).toBe('**기본 설정**');
    expect(fixMisalignedBoldMarks('설**정값**')).toBe('**설정값**');
  });

  // 코드 블록 내부는 건드리지 않음
  it('코드 블록 내부는 보존', () => {
    const input = '```\n**partial**rest\n```';
    expect(fixMisalignedBoldMarks(input)).toBe(input);
  });

  it('코드 블록 외부만 보정', () => {
    const input = '**partial**rest\n```\n**partial**rest\n```\n**partial**rest';
    const expected = '**partialrest**\n```\n**partial**rest\n```\n**partialrest**';
    expect(fixMisalignedBoldMarks(input)).toBe(expected);
  });

  // 정상 bold는 변경 없음
  it('정상적인 bold는 변경하지 않음', () => {
    expect(fixMisalignedBoldMarks('**normal bold**')).toBe('**normal bold**');
    expect(fixMisalignedBoldMarks('text **bold** more')).toBe('text **bold** more');
    expect(fixMisalignedBoldMarks('**한국어 볼드** 텍스트')).toBe('**한국어 볼드** 텍스트');
  });

  // 빈 문자열
  it('빈 문자열 처리', () => {
    expect(fixMisalignedBoldMarks('')).toBe('');
  });

  // bold가 없는 텍스트
  it('bold 마크가 없는 텍스트는 그대로', () => {
    expect(fixMisalignedBoldMarks('plain text without bold')).toBe('plain text without bold');
  });

  // 여러 bold가 한 줄에 있는 경우
  it('한 줄에 여러 misaligned bold 처리', () => {
    expect(fixMisalignedBoldMarks('**Two typ**es and **default s**etting'))
      .toBe('**Two types** and **default setting**');
  });

  // 인라인 코드(`)는 건드리지 않음
  it('인라인 코드 backtick은 건드리지 않음', () => {
    expect(fixMisalignedBoldMarks('`code`block')).toBe('`code`block');
  });
});
