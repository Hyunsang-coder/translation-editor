/**
 * 표 안 리스트 왕복 테스트 (빌드 없이 `npx vitest run`으로 실행).
 *
 * 문서 폴리싱/번역 경로는 테이블을 HTML로 직렬화(TableForTranslation)하고
 * 응답 파싱 때 ProseMirror DOMParser로 되돌린다(parseTranslationResponseToTipTap).
 * 셀 안 불릿 리스트가 그 왕복에서 살아남는지 고정한다.
 *
 * 선택 영역 경로(부분 폴리싱/재번역)는 평문 교체라 이 구조를 나를 수 없다 —
 * 그쪽 한계는 applySelectionEdit의 sameParent 규칙으로 코드상 자명해서
 * 여기서는 다루지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  extractBetweenMarkers,
  markdownToTipTapJsonForTranslation,
  parseTranslationResponseToTipTap,
  tipTapJsonToMarkdownForTranslation,
} from './markdownConverter';

const CELL_LIST_ITEMS = ['첫 번째 항목', '두 번째 항목'];

const docWithListInTable = {
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
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목' }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '설명' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '과일' }] },
                {
                  type: 'bulletList',
                  content: CELL_LIST_ITEMS.map((item) => ({
                    type: 'listItem',
                    content: [
                      { type: 'paragraph', content: [{ type: 'text', text: item }] },
                    ],
                  })),
                },
              ],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '맛있다' }] }],
            },
          ],
        },
      ],
    },
  ],
};

function findTable(doc: { content?: Array<{ type?: string }> }) {
  return (doc.content ?? []).find((node) => node.type === 'table') as unknown as {
    content: Array<{
      content: Array<{ content: Array<{ type?: string; content?: unknown[] }> }>;
    }>;
  };
}

function cellBlocks(doc: unknown, row: number, col: number): Array<{ type?: string }> {
  const table = findTable(doc as { content?: Array<{ type?: string }> });
  return table.content[row]!.content[col]!.content as Array<{ type?: string }>;
}

function listItemTexts(bulletList: unknown): string[] {
  const list = bulletList as {
    content: Array<{ content: Array<{ content: Array<{ text?: string }> }> }>;
  };
  return list.content.map((item) => item.content[0]!.content[0]!.text ?? '');
}

describe('표 안 리스트 왕복', () => {
  it('번역용 직렬화는 표를 HTML로 내보내고 리스트를 살린다', () => {
    const md = tipTapJsonToMarkdownForTranslation(docWithListInTable);
    expect(md).toContain('<table');
    expect(md).toContain('<li>');
    expect(md).toContain('첫 번째 항목');
    expect(md).toContain('두 번째 항목');
  });

  it('왕복 후 표 크기·셀 안 리스트 항목이 보존된다', () => {
    const md = tipTapJsonToMarkdownForTranslation(docWithListInTable);
    const back = markdownToTipTapJsonForTranslation(md);

    const table = findTable(back);
    expect(table.content).toHaveLength(2); // 헤더행 + 본문행
    expect(table.content[0]!.content).toHaveLength(2);
    expect(table.content[1]!.content).toHaveLength(2);

    const blocks = cellBlocks(back, 1, 0);
    const bullet = blocks.find((b) => b.type === 'bulletList');
    expect(bullet).toBeDefined();
    expect(listItemTexts(bullet)).toEqual(CELL_LIST_ITEMS);
  });

  it('폴리싱 응답 시뮬레이션 — POLISH 마커 추출 후 파싱해도 구조가 산다', () => {
    const md = tipTapJsonToMarkdownForTranslation(docWithListInTable);
    const raw = `사족\n---POLISH_START---\n${md}\n---POLISH_END---\n사족`;
    const extracted = extractBetweenMarkers(
      raw,
      '---POLISH_START---',
      '---POLISH_END---',
      '[Polish-Test]',
    );
    const doc = parseTranslationResponseToTipTap(extracted);

    const blocks = cellBlocks(doc, 1, 0);
    const bullet = blocks.find((b) => b.type === 'bulletList');
    expect(bullet).toBeDefined();
    expect(listItemTexts(bullet)).toEqual(CELL_LIST_ITEMS);
  });
});
