import { describe, expect, it } from 'vitest';
import type { TipTapDocJson } from '@/utils/markdownConverter';
import {
  DocumentIntegrityError,
  assertDocumentIntegrity,
  evaluateDocumentIntegrity,
} from './documentIntegrity';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function richDocument(): TipTapDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, translationUnitId: 'heading-1' },
        content: [{ type: 'text', text: 'Release Guide' }],
      },
      {
        type: 'paragraph',
        attrs: { translationUnitId: 'paragraph-1' },
        content: [
          { type: 'text', text: 'Open ' },
          {
            type: 'text',
            text: 'the dashboard',
            marks: [
              { type: 'bold' },
              { type: 'link', attrs: { href: 'https://example.com/dashboard', target: '_blank' } },
            ],
          },
          { type: 'text', text: ' with {playerName} on 2026-09-09.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                attrs: { translationUnitId: 'list-1' },
                content: [{ type: 'text', text: 'Press Ctrl+Shift+P.' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                attrs: { translationUnitId: 'list-2' },
                content: [{ type: 'text', text: 'Keep API version v3.14.1.' }],
              },
            ],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 2, rowspan: 1, colwidth: [120, 120] },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { translationUnitId: 'table-header' },
                    content: [{ type: 'text', text: 'Configuration' }],
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
                attrs: {
                  translationUnitId: 'table-cell-1',
                  colspan: 1,
                  rowspan: 1,
                  colwidth: [120],
                },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { translationUnitId: 'table-cell-1-p' },
                    content: [{ type: 'text', text: 'Retries' }],
                  },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          {
                            type: 'paragraph',
                            attrs: { translationUnitId: 'table-cell-1-li' },
                            content: [{ type: 'text', text: 'Maximum: 3' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'tableCell',
                attrs: {
                  translationUnitId: 'table-cell-2',
                  colspan: 1,
                  rowspan: 1,
                  colwidth: [120],
                },
                content: [
                  {
                    type: 'paragraph',
                    attrs: { translationUnitId: 'table-cell-2-p' },
                    content: [{ type: 'text', text: '%s' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'image',
        attrs: {
          src: 'https://example.com/diagram.png',
          alt: 'architecture diagram',
          title: 'Architecture',
          width: 640,
          height: 360,
        },
      },
      {
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [{ type: 'text', text: '{"maxRetries": 3}' }],
      },
    ],
  };
}

function translatedDocument(): TipTapDocJson {
  const translated = clone(richDocument());
  const content = translated.content as TipTapDocJson[];

  (content[0]!.content as TipTapDocJson[])[0]!.text = '릴리스 가이드';
  const paragraph = content[1]!.content as TipTapDocJson[];
  paragraph[0]!.text = '다음 링크에서 ';
  paragraph[1]!.text = '대시보드';
  paragraph[2]!.text = '를 열고 {playerName}으로 2026-09-09에 접속합니다.';
  const list = content[2]!.content as TipTapDocJson[];
  (((list[0]!.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[0]!).text =
    'Ctrl+Shift+P를 누릅니다.';
  (((list[1]!.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[0]!).text =
    'API 버전 v3.14.1을 유지합니다.';

  const table = content[3]!.content as TipTapDocJson[];
  const headerCell = (table[0]!.content as TipTapDocJson[])[0]!;
  (((headerCell.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[0]!).text = '설정';
  const firstCell = (table[1]!.content as TipTapDocJson[])[0]!;
  (((firstCell.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[0]!).text = '재시도';
  const nestedList = (firstCell.content as TipTapDocJson[])[1]!;
  (((((nestedList.content as TipTapDocJson[])[0]!.content as TipTapDocJson[])[0]!
    .content as TipTapDocJson[])[0]!)).text = '최대: 3';

  return translated;
}

function issueCodes(source: TipTapDocJson, target: TipTapDocJson): string[] {
  return evaluateDocumentIntegrity(source, target).issues.map((issue) => issue.code);
}

describe('evaluateDocumentIntegrity', () => {
  it('텍스트만 번역되고 구조·표·이미지·마크·보호 리터럴·ID가 같으면 통과한다', () => {
    const report = evaluateDocumentIntegrity(richDocument(), translatedDocument());

    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it('heading level이나 목록 계층이 바뀌면 topology 실패다', () => {
    const headingChanged = translatedDocument();
    ((headingChanged.content as TipTapDocJson[])[0]!.attrs as Record<string, unknown>).level = 3;
    expect(issueCodes(richDocument(), headingChanged)).toContain('topology');

    const listChanged = translatedDocument();
    (listChanged.content as TipTapDocJson[])[2]!.type = 'orderedList';
    expect(issueCodes(richDocument(), listChanged)).toContain('topology');
  });

  it('표 행·열·병합 속성·셀 내부 목록이 바뀌면 table-geometry 실패다', () => {
    const missingCell = translatedDocument();
    const rows = (missingCell.content as TipTapDocJson[])[3]!.content as TipTapDocJson[];
    (rows[1]!.content as TipTapDocJson[]).pop();
    expect(issueCodes(richDocument(), missingCell)).toContain('table-geometry');

    const colspanChanged = translatedDocument();
    const header = ((((colspanChanged.content as TipTapDocJson[])[3]!.content as TipTapDocJson[])[0]!
      .content as TipTapDocJson[])[0]!);
    (header.attrs as Record<string, unknown>).colspan = 1;
    expect(issueCodes(richDocument(), colspanChanged)).toContain('table-geometry');

    const listFlattened = translatedDocument();
    const firstCell = (((listFlattened.content as TipTapDocJson[])[3]!.content as TipTapDocJson[])[1]!
      .content as TipTapDocJson[])[0]!;
    (firstCell.content as TipTapDocJson[])[1] = {
      type: 'paragraph',
      content: [{ type: 'text', text: '최대: 3' }],
    };
    expect(issueCodes(richDocument(), listFlattened)).toContain('table-geometry');
  });

  it('이미지가 삭제·이동되거나 원본 속성이 바뀌면 image-integrity 실패다', () => {
    const deleted = translatedDocument();
    (deleted.content as TipTapDocJson[]).splice(4, 1);
    expect(issueCodes(richDocument(), deleted)).toContain('image-integrity');

    const changed = translatedDocument();
    const image = (changed.content as TipTapDocJson[])[4]!;
    (image.attrs as Record<string, unknown>).src = 'https://example.com/other.png';
    expect(issueCodes(richDocument(), changed)).toContain('image-integrity');

    const moved = translatedDocument();
    const blocks = moved.content as TipTapDocJson[];
    [blocks[3], blocks[4]] = [blocks[4]!, blocks[3]!];
    expect(issueCodes(richDocument(), moved)).toContain('image-integrity');
  });

  it('링크 URL이나 bold/link 마크가 사라지면 mark-integrity 실패다', () => {
    const hrefChanged = translatedDocument();
    const marked = ((hrefChanged.content as TipTapDocJson[])[1]!.content as TipTapDocJson[])[1]!;
    const link = (marked.marks as Array<Record<string, unknown>>)[1]!;
    (link.attrs as Record<string, unknown>).href = 'https://evil.example';
    expect(issueCodes(richDocument(), hrefChanged)).toContain('mark-integrity');

    const boldRemoved = translatedDocument();
    const markedWithoutBold =
      ((boldRemoved.content as TipTapDocJson[])[1]!.content as TipTapDocJson[])[1]!;
    markedWithoutBold.marks = (markedWithoutBold.marks as TipTapDocJson[])
      .filter((mark) => mark.type !== 'bold');
    expect(issueCodes(richDocument(), boldRemoved)).toContain('mark-integrity');
  });

  it('코드·숫자·placeholder·날짜·버전·키 조합이 바뀌면 protected-literal 실패다', () => {
    const placeholderChanged = translatedDocument();
    const paragraph = (placeholderChanged.content as TipTapDocJson[])[1]!.content as TipTapDocJson[];
    paragraph[2]!.text = '를 열고 {userName}으로 2026-09-10에 접속합니다.';
    expect(issueCodes(richDocument(), placeholderChanged)).toContain('protected-literal');

    const codeChanged = translatedDocument();
    const code = (codeChanged.content as TipTapDocJson[])[5]!.content as TipTapDocJson[];
    code[0]!.text = '{"maxRetries": 5}';
    expect(issueCodes(richDocument(), codeChanged)).toContain('protected-literal');
  });

  it('숫자 뒤에 한국어 단위가 붙어도 같은 숫자로 인식한다', () => {
    const source: TipTapDocJson = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Retry 3 times.' }],
      }],
    };
    const target: TipTapDocJson = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '3회 재시도합니다.' }],
      }],
    };

    expect(evaluateDocumentIntegrity(source, target).passed).toBe(true);
  });

  it('translationUnitId가 누락되거나 다른 ID가 붙으면 translation-unit-id 실패다', () => {
    const changed = translatedDocument();
    const heading = (changed.content as TipTapDocJson[])[0]!;
    (heading.attrs as Record<string, unknown>).translationUnitId = 'invented';

    expect(issueCodes(richDocument(), changed)).toContain('translation-unit-id');
  });

  it('assertDocumentIntegrity는 한 항목이라도 실패하면 상세 오류를 던진다', () => {
    const changed = translatedDocument();
    (changed.content as TipTapDocJson[]).pop();

    expect(() => assertDocumentIntegrity(richDocument(), changed, '번역 결과'))
      .toThrow(DocumentIntegrityError);
    expect(() => assertDocumentIntegrity(richDocument(), changed, '번역 결과'))
      .toThrow(/번역 결과.*문서 무결성/);
  });
});
