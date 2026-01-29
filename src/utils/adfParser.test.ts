/**
 * adfParser.ts 단위 테스트
 *
 * Confluence ADF (Atlassian Document Format) 파싱 유틸리티 테스트
 * - extractText: 텍스트 추출
 * - extractSection: 특정 섹션 추출
 * - extractUntilSection: 특정 섹션 전까지 추출
 * - filterByContentType: 콘텐츠 타입별 필터링
 * - listAvailableSections: 섹션 목록 조회
 */
import { describe, it, expect } from 'vitest';
import {
  extractText,
  extractSection,
  extractUntilSection,
  filterByContentType,
  listAvailableSections,
  type AdfNode as _AdfNode,
  type AdfDocument,
} from './adfParser';

// ============================================================================
// Test Fixtures - Realistic ADF structures matching Confluence format
// ============================================================================

/**
 * 기본 문서 - 단순 텍스트
 */
const simpleDoc: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello world' },
      ],
    },
  ],
};

/**
 * 중첩 구조 문서 - 여러 문단
 */
const nestedDoc: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'First paragraph. ' },
        { type: 'text', text: 'More text.', marks: [{ type: 'strong' }] },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Second paragraph.' },
      ],
    },
  ],
};

/**
 * 코드 블록 포함 문서
 */
const docWithCodeBlock: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Before code' },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [
        { type: 'text', text: 'const x = 1;' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'After code' },
      ],
    },
  ],
};

/**
 * 빈 문서
 */
const emptyDoc: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [],
};

/**
 * 섹션 구조 문서 - Heading 기반
 */
const sectionedDoc: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Introduction' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'This is the introduction section.' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Overview' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Overview content here.' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Details' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Details content here.' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Sub-details' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Nested under Details.' }],
    },
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Conclusion' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Final thoughts.' }],
    },
  ],
};

/**
 * 테이블 포함 문서
 */
const docWithTable: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Introduction text.' }],
    },
    {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: {},
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Header 1' }],
                },
              ],
            },
            {
              type: 'tableHeader',
              attrs: {},
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Header 2' }],
                },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: {},
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Cell A' }],
                },
              ],
            },
            {
              type: 'tableCell',
              attrs: {},
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Cell B' }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Conclusion text.' }],
    },
  ],
};

/**
 * 복합 문서 - 테이블, 코드블록, 섹션 모두 포함
 */
const complexDoc: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Project Overview' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'This document describes the project.' }],
    },
    {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: {},
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] },
              ],
            },
            {
              type: 'tableHeader',
              attrs: {},
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Status' }] },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: {},
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Authentication' }] },
              ],
            },
            {
              type: 'tableCell',
              attrs: {},
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Complete' }] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Code Examples' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: 'function hello() { return "world"; }' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Above is a sample function.' }],
    },
  ],
};

// ============================================================================
// extractText tests
// ============================================================================

describe('extractText', () => {
  it('기본 텍스트를 추출한다', () => {
    const result = extractText(simpleDoc);
    expect(result).toBe('Hello world');
  });

  it('중첩 구조에서 모든 텍스트를 추출한다', () => {
    const result = extractText(nestedDoc);
    expect(result).toContain('First paragraph.');
    expect(result).toContain('More text.');
    expect(result).toContain('Second paragraph.');
  });

  it('codeBlock을 제외하고 추출한다', () => {
    const result = extractText(docWithCodeBlock, { excludeTypes: ['codeBlock'] });
    expect(result).toContain('Before code');
    expect(result).toContain('After code');
    expect(result).not.toContain('const x = 1');
  });

  it('기본 옵션으로 codeBlock 내용도 포함한다', () => {
    const result = extractText(docWithCodeBlock);
    expect(result).toContain('Before code');
    expect(result).toContain('const x = 1');
    expect(result).toContain('After code');
  });

  it('빈 문서는 빈 문자열을 반환한다', () => {
    const result = extractText(emptyDoc);
    expect(result).toBe('');
  });

  it('테이블 내 텍스트도 추출한다', () => {
    const result = extractText(docWithTable);
    expect(result).toContain('Introduction text.');
    expect(result).toContain('Header 1');
    expect(result).toContain('Header 2');
    expect(result).toContain('Cell A');
    expect(result).toContain('Cell B');
    expect(result).toContain('Conclusion text.');
  });

  it('여러 타입을 동시에 제외할 수 있다', () => {
    const result = extractText(complexDoc, { excludeTypes: ['codeBlock', 'table'] });
    expect(result).toContain('This document describes the project.');
    expect(result).toContain('Above is a sample function.');
    expect(result).not.toContain('Authentication');
    expect(result).not.toContain('function hello()');
  });
});

// ============================================================================
// extractSection tests
// ============================================================================

describe('extractSection', () => {
  it('존재하는 섹션을 추출한다', () => {
    const result = extractSection(sectionedDoc, 'Details');
    expect(result.found).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    // Details 섹션의 내용 확인
    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Details content here.');
  });

  it('동급 heading에서 섹션이 종료된다', () => {
    const result = extractSection(sectionedDoc, 'Overview');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Overview content here.');
    expect(text).not.toContain('Details content here.'); // 동급 h2에서 종료
  });

  it('하위 heading은 섹션에 포함된다', () => {
    const result = extractSection(sectionedDoc, 'Details');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Details content here.');
    expect(text).toContain('Sub-details'); // h3는 h2 섹션에 포함
    expect(text).toContain('Nested under Details.');
  });

  it('마지막 섹션도 올바르게 추출한다', () => {
    const result = extractSection(sectionedDoc, 'Conclusion');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Final thoughts.');
  });

  it('존재하지 않는 섹션은 found: false를 반환한다', () => {
    const result = extractSection(sectionedDoc, 'NonExistent');
    expect(result.found).toBe(false);
    expect(result.content).toEqual([]);
  });

  it('대소문자를 무시하고 매칭한다', () => {
    const result = extractSection(sectionedDoc, 'DETAILS');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Details content here.');
  });

  it('빈 문서에서는 found: false를 반환한다', () => {
    const result = extractSection(emptyDoc, 'Any');
    expect(result.found).toBe(false);
    expect(result.content).toEqual([]);
  });

  it('상위 레벨 heading에서도 섹션이 종료된다', () => {
    // h2 섹션은 h1이 나오면 종료되어야 함
    const result = extractSection(sectionedDoc, 'Overview');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).not.toContain('Conclusion'); // h1에서 종료
    expect(text).not.toContain('Final thoughts.');
  });
});

// ============================================================================
// extractUntilSection tests
// ============================================================================

describe('extractUntilSection', () => {
  it('지정한 섹션 전까지의 내용을 추출한다', () => {
    const result = extractUntilSection(sectionedDoc, 'Details');
    expect(result.found).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Introduction');
    expect(text).toContain('This is the introduction section.');
    expect(text).toContain('Overview');
    expect(text).toContain('Overview content here.');
    expect(text).not.toContain('Details content here.');
  });

  it('첫 번째 섹션 전까지 추출한다', () => {
    const result = extractUntilSection(sectionedDoc, 'Introduction');
    expect(result.found).toBe(true);
    // Introduction이 첫 번째이므로 그 전에는 아무것도 없음
    expect(result.content).toEqual([]);
  });

  it('존재하지 않는 섹션은 found: false를 반환한다', () => {
    const result = extractUntilSection(sectionedDoc, 'NonExistent');
    expect(result.found).toBe(false);
    expect(result.content).toEqual([]);
  });

  it('대소문자를 무시하고 매칭한다', () => {
    const result = extractUntilSection(sectionedDoc, 'CONCLUSION');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Introduction');
    expect(text).toContain('Details content here.');
    expect(text).not.toContain('Final thoughts.');
  });

  it('빈 문서에서는 found: false를 반환한다', () => {
    const result = extractUntilSection(emptyDoc, 'Any');
    expect(result.found).toBe(false);
    expect(result.content).toEqual([]);
  });

  it('중간 섹션까지 정확히 추출한다', () => {
    const result = extractUntilSection(sectionedDoc, 'Conclusion');
    expect(result.found).toBe(true);

    const text = extractText({ version: 1, type: 'doc', content: result.content });
    expect(text).toContain('Sub-details');
    expect(text).toContain('Nested under Details.');
    expect(text).not.toContain('Final thoughts.');
  });
});

// ============================================================================
// filterByContentType tests
// ============================================================================

describe('filterByContentType', () => {
  it('filter="table"로 테이블 노드만 반환한다', () => {
    const result = filterByContentType(docWithTable, 'table');
    expect(result.content.length).toBe(1);
    expect(result.content[0]!.type).toBe('table');

    const text = extractText(result);
    expect(text).toContain('Header 1');
    expect(text).toContain('Cell A');
    expect(text).not.toContain('Introduction text.');
    expect(text).not.toContain('Conclusion text.');
  });

  it('filter="text"로 테이블을 제외한 노드를 반환한다', () => {
    const result = filterByContentType(docWithTable, 'text');

    const text = extractText(result);
    expect(text).toContain('Introduction text.');
    expect(text).toContain('Conclusion text.');
    expect(text).not.toContain('Header 1');
    expect(text).not.toContain('Cell A');
  });

  it('filter="all"로 모든 노드를 반환한다', () => {
    const result = filterByContentType(docWithTable, 'all');
    expect(result.content.length).toBe(docWithTable.content.length);

    const text = extractText(result);
    expect(text).toContain('Introduction text.');
    expect(text).toContain('Header 1');
    expect(text).toContain('Conclusion text.');
  });

  it('테이블이 없는 문서에서 filter="table"은 빈 결과를 반환한다', () => {
    const result = filterByContentType(simpleDoc, 'table');
    expect(result.content.length).toBe(0);
  });

  it('테이블이 없는 문서에서 filter="text"는 전체를 반환한다', () => {
    const result = filterByContentType(simpleDoc, 'text');
    expect(result.content.length).toBe(simpleDoc.content.length);
  });

  it('복합 문서에서 테이블만 필터링한다', () => {
    const result = filterByContentType(complexDoc, 'table');
    expect(result.content.length).toBe(1);
    expect(result.content[0]!.type).toBe('table');

    const text = extractText(result);
    expect(text).toContain('Feature');
    expect(text).toContain('Authentication');
    expect(text).not.toContain('This document describes the project.');
  });

  it('빈 문서에서는 빈 결과를 반환한다', () => {
    const tableResult = filterByContentType(emptyDoc, 'table');
    const textResult = filterByContentType(emptyDoc, 'text');
    const allResult = filterByContentType(emptyDoc, 'all');

    expect(tableResult.content).toEqual([]);
    expect(textResult.content).toEqual([]);
    expect(allResult.content).toEqual([]);
  });
});

// ============================================================================
// listAvailableSections tests
// ============================================================================

describe('listAvailableSections', () => {
  it('모든 heading 텍스트를 반환한다', () => {
    const sections = listAvailableSections(sectionedDoc);
    expect(sections).toContain('Introduction');
    expect(sections).toContain('Overview');
    expect(sections).toContain('Details');
    expect(sections).toContain('Sub-details');
    expect(sections).toContain('Conclusion');
    expect(sections.length).toBe(5);
  });

  it('빈 문서는 빈 배열을 반환한다', () => {
    const sections = listAvailableSections(emptyDoc);
    expect(sections).toEqual([]);
  });

  it('heading이 없는 문서는 빈 배열을 반환한다', () => {
    const sections = listAvailableSections(simpleDoc);
    expect(sections).toEqual([]);
  });

  it('복합 문서에서도 heading을 정확히 추출한다', () => {
    const sections = listAvailableSections(complexDoc);
    expect(sections).toContain('Project Overview');
    expect(sections).toContain('Code Examples');
    expect(sections.length).toBe(2);
  });

  it('heading 순서가 문서 순서와 동일하다', () => {
    const sections = listAvailableSections(sectionedDoc);
    expect(sections[0]).toBe('Introduction');
    expect(sections[1]).toBe('Overview');
    expect(sections[2]).toBe('Details');
    expect(sections[3]).toBe('Sub-details');
    expect(sections[4]).toBe('Conclusion');
  });

  it('heading 레벨 정보도 함께 반환할 수 있다', () => {
    const sections = listAvailableSections(sectionedDoc, { includeLevel: true });
    expect(sections).toEqual([
      { text: 'Introduction', level: 1 },
      { text: 'Overview', level: 2 },
      { text: 'Details', level: 2 },
      { text: 'Sub-details', level: 3 },
      { text: 'Conclusion', level: 1 },
    ]);
  });
});

// ============================================================================
// Edge cases and integration tests
// ============================================================================

describe('Edge Cases', () => {
  it('content가 없는 노드를 처리한다', () => {
    const docWithEmptyNodes: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        { type: 'paragraph' }, // content 없음
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Valid text' }],
        },
      ],
    };

    const text = extractText(docWithEmptyNodes);
    expect(text).toContain('Valid text');
  });

  it('text가 없는 텍스트 노드를 처리한다', () => {
    const docWithEmptyText: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text' }, // text 없음
            { type: 'text', text: 'Valid' },
          ],
        },
      ],
    };

    const text = extractText(docWithEmptyText);
    expect(text).toContain('Valid');
  });

  it('깊게 중첩된 구조를 처리한다', () => {
    const deeplyNested: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Level 1' }],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Level 2' }],
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

    const text = extractText(deeplyNested);
    expect(text).toContain('Level 1');
    expect(text).toContain('Level 2');
  });

  it('Confluence 특수 노드 타입을 처리한다', () => {
    const confluenceSpecial: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before' }],
        },
        {
          type: 'expand',
          attrs: { title: 'Click to expand' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hidden content' }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'After' }],
        },
      ],
    };

    const text = extractText(confluenceSpecial);
    expect(text).toContain('Before');
    expect(text).toContain('Hidden content');
    expect(text).toContain('After');
  });

  it('inlineCard, mediaGroup 등 미디어 노드를 건너뛴다', () => {
    const docWithMedia: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Check this link: ' },
            {
              type: 'inlineCard',
              attrs: { url: 'https://example.com' },
            },
          ],
        },
        {
          type: 'mediaGroup',
          content: [
            {
              type: 'media',
              attrs: { id: 'abc', type: 'file', collection: 'files' },
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'End of document' }],
        },
      ],
    };

    const text = extractText(docWithMedia);
    expect(text).toContain('Check this link:');
    expect(text).toContain('End of document');
    expect(text).not.toContain('https://example.com');
  });
});

describe('Integration: Section + Filter', () => {
  const integratedDoc: AdfDocument = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Summary' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Summary text.' }],
      },
      {
        type: 'table',
        attrs: {},
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: {},
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Summary Table' }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Details' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Details text.' }],
      },
      {
        type: 'table',
        attrs: {},
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: {},
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Details Table' }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('섹션 추출 후 테이블만 필터링할 수 있다', () => {
    const section = extractSection(integratedDoc, 'Summary');
    expect(section.found).toBe(true);

    const sectionDoc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: section.content,
    };

    const tableOnly = filterByContentType(sectionDoc, 'table');
    const text = extractText(tableOnly);

    expect(text).toContain('Summary Table');
    expect(text).not.toContain('Details Table');
    expect(text).not.toContain('Summary text.');
  });

  it('untilSection으로 특정 섹션 전까지 추출 후 텍스트만 필터링할 수 있다', () => {
    const until = extractUntilSection(integratedDoc, 'Details');
    expect(until.found).toBe(true);

    const untilDoc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: until.content,
    };

    const textOnly = filterByContentType(untilDoc, 'text');
    const text = extractText(textOnly);

    expect(text).toContain('Summary text.');
    expect(text).not.toContain('Summary Table');
    expect(text).not.toContain('Details text.');
  });
});
