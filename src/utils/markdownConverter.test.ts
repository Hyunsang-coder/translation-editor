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
} from './markdownConverter';

describe('markdownConverter - 기존 함수 (html: false)', () => {
  it('Markdown 테이블이 올바르게 파싱되어야 함', () => {
    const mdTable = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;

    const json = markdownToTipTapJson(mdTable);

    console.log('Markdown table JSON:', JSON.stringify(json, null, 2));

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

    console.log('Complex table to Markdown:', markdown);

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

    console.log('Simple table to Markdown:', markdown);

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

    console.log('ForTranslation - Complex table:', markdown);

    // HTML 테이블로 변환되어야 함 (not [table])
    // TipTap은 style 속성을 포함한 <table style="..."> 형태로 출력
    expect(markdown).toContain('<table');
    expect(markdown).toContain('Header');
    expect(markdown).toContain('Line 1');
    expect(markdown).toContain('Line 2');
    expect(markdown).not.toContain('[table]');
  });

  it('markdownToTipTapJsonForTranslation: HTML 테이블이 TipTap JSON으로 파싱되어야 함', () => {
    const htmlTable = `<table>
      <tr><th>Header 1</th><th>Header 2</th></tr>
      <tr><td>Cell 1</td><td>Cell 2</td></tr>
    </table>`;

    const json = markdownToTipTapJsonForTranslation(htmlTable);

    console.log('ForTranslation - HTML to JSON:', JSON.stringify(json, null, 2));

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
    console.log('Roundtrip - Markdown:', markdown);

    // Markdown (HTML) → JSON
    const restoredJson = markdownToTipTapJsonForTranslation(markdown);
    console.log('Roundtrip - Restored JSON:', JSON.stringify(restoredJson, null, 2));

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

    console.log('Review pipeline - Markdown output:', markdown);

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

    console.log('Table with list - Markdown output:', markdown);

    // HTML 테이블로 변환되어야 함
    expect(markdown).toContain('<table');
    expect(markdown).not.toContain('[table]');

    // 모든 내용 보존
    expect(markdown).toContain('할 일');
    expect(markdown).toContain('항목 A');
    expect(markdown).toContain('항목 B');
  });
});
