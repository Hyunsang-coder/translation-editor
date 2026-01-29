/**
 * wordCounter.ts 단위 테스트
 *
 * TRD 참조: docs/trd/09-specialized.md 9.3절, docs/trd/13-algorithms.md 13.10절
 */
import { describe, it, expect } from 'vitest';
import {
  preprocessContent,
  extractSection,
  extractUntilSection,
  extractTables,
  removeTables,
  countTotalWords,
  countByLanguage,
  calculateTotal,
  extractPageIdFromUrl,
  countWords,
  aggregateResults,
  formatWordCountResult,
  formatMultiPageResults,
  isNonWordToken,
  type WordCountBreakdown,
  type PageWordCountResult,
} from './wordCounter';

describe('preprocessContent', () => {
  it('Markdown 이미지를 제거한다', () => {
    const content = 'Hello ![alt](https://example.com/image.png) World';
    expect(preprocessContent(content)).toBe('Hello World');
  });

  it('HTML 이미지를 제거한다', () => {
    const content = 'Hello <img src="test.png" alt="test"> World';
    expect(preprocessContent(content)).toBe('Hello World');
  });

  it('Markdown 링크에서 텍스트만 유지한다', () => {
    const content = 'See [documentation](https://docs.example.com) for details';
    expect(preprocessContent(content)).toBe('See documentation for details');
  });

  it('순수 URL을 제거한다', () => {
    const content = 'Visit https://example.com for more info';
    expect(preprocessContent(content)).toBe('Visit for more info');
  });

  it('펜스 코드 블록을 제거한다', () => {
    const content = 'Code:\n```javascript\nconst x = 1;\n```\nEnd';
    expect(preprocessContent(content)).toBe('Code: End');
  });

  it('인라인 코드를 제거한다', () => {
    const content = 'Use `console.log()` for debugging';
    expect(preprocessContent(content)).toBe('Use for debugging');
  });

  it('Confluence code 매크로를 제거한다', () => {
    const content = 'Content <ac:structured-macro ac:name="code"><ac:plain-text-body>code</ac:plain-text-body></ac:structured-macro> more';
    expect(preprocessContent(content)).toBe('Content more');
  });

  it('Confluence expand 매크로 내 텍스트는 유지한다', () => {
    const content = 'Before <ac:structured-macro ac:name="expand"><ac:rich-text-body>Hidden text</ac:rich-text-body></ac:structured-macro> After';
    // expand 매크로는 제거하지 않음 - 내부 텍스트 포함
    expect(preprocessContent(content)).toContain('Hidden text');
  });

  it('iframe을 제거한다', () => {
    const content = 'Video: <iframe src="https://youtube.com/embed/xxx"></iframe> End';
    expect(preprocessContent(content)).toBe('Video: End');
  });
});

describe('countTotalWords', () => {
  it('공백으로 구분된 단어 수를 센다', () => {
    expect(countTotalWords('Hello world test')).toBe(3);
  });

  it('숫자도 단어로 센다', () => {
    expect(countTotalWords('version 2 test 123')).toBe(4);
  });

  it('한국어 단어를 공백으로 구분해서 센다', () => {
    expect(countTotalWords('안녕하세요 반갑습니다 테스트')).toBe(3);
  });

  it('영어+한국어 혼합 텍스트를 센다', () => {
    expect(countTotalWords('Hello 세계 world 안녕')).toBe(4);
  });

  it('HTML 태그를 제거하고 센다', () => {
    expect(countTotalWords('<p>Hello</p><p>World</p>')).toBe(2);
  });

  it('테이블 HTML도 처리한다', () => {
    const html = '<table><tr><td>Hello</td><td>World</td></tr></table>';
    // 각 셀이 공백으로 분리되어 2단어로 카운트
    expect(countTotalWords(html)).toBe(2);
  });

  it('코드 블록은 제외한다', () => {
    const content = 'Hello ```const x = 1;``` World';
    expect(countTotalWords(content)).toBe(2);
  });

  it('URL은 제외한다', () => {
    const content = 'Visit https://example.com today';
    expect(countTotalWords(content)).toBe(2);
  });

  it('빈 문자열은 0을 반환한다', () => {
    expect(countTotalWords('')).toBe(0);
    expect(countTotalWords('   ')).toBe(0);
  });
});

describe('extractTables', () => {
  it('Markdown 표에서 내용을 추출한다', () => {
    const content = `# Title

Some text here.

| Name | Value |
|------|-------|
| Apple | Red |
| Banana | Yellow |

More text after table.`;

    const result = extractTables(content);
    expect(result).toContain('Apple');
    expect(result).toContain('Red');
    expect(result).toContain('Banana');
    expect(result).toContain('Yellow');
    expect(result).not.toContain('Some text here');
    expect(result).not.toContain('More text after');
  });

  it('여러 표를 모두 추출한다', () => {
    const content = `| A | B |
|---|---|
| 1 | 2 |

Text between tables.

| C | D |
|---|---|
| 3 | 4 |`;

    const result = extractTables(content);
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
    expect(result).toContain('4');
  });

  it('표가 없으면 빈 문자열을 반환한다', () => {
    const content = 'Just plain text without any tables.';
    const result = extractTables(content);
    expect(result.trim()).toBe('');
  });
});

describe('removeTables', () => {
  it('Markdown 표를 제거하고 나머지 텍스트를 반환한다', () => {
    const content = `# Title

Some text here.

| Name | Value |
|------|-------|
| Apple | Red |

More text after table.`;

    const result = removeTables(content);
    expect(result).toContain('Title');
    expect(result).toContain('Some text here');
    expect(result).toContain('More text after table');
    expect(result).not.toContain('Apple');
    expect(result).not.toContain('Red');
  });

  it('표가 없으면 원본을 그대로 반환한다', () => {
    const content = 'Just plain text.';
    const result = removeTables(content);
    expect(result).toBe(content);
  });
});

describe('extractUntilSection', () => {
  const sampleContent = `# Introduction

This is the intro section.

## Overview

Overview content here.

## Details

Details content here.

## Conclusion

Final thoughts.`;

  it('처음부터 지정한 섹션 전까지 추출한다', () => {
    const result = extractUntilSection(sampleContent, 'Details');
    expect(result).not.toBeNull();
    expect(result).toContain('Introduction');
    expect(result).toContain('This is the intro section');
    expect(result).toContain('Overview');
    expect(result).toContain('Overview content here');
    expect(result).not.toContain('Details content here');
    expect(result).not.toContain('Final thoughts');
  });

  it('첫 번째 섹션 전까지 추출한다', () => {
    const content = `Some intro text.

# First Section

First content.`;
    const result = extractUntilSection(content, 'First Section');
    expect(result).not.toBeNull();
    expect(result).toContain('Some intro text');
    expect(result).not.toContain('First content');
  });

  it('존재하지 않는 섹션에 대해 null을 반환한다', () => {
    const result = extractUntilSection(sampleContent, 'NonExistent');
    expect(result).toBeNull();
  });

  it('대소문자를 무시하고 매칭한다', () => {
    const result = extractUntilSection(sampleContent, 'DETAILS');
    expect(result).not.toBeNull();
    expect(result).toContain('Overview content here');
    expect(result).not.toContain('Details content here');
  });
});

describe('extractSection', () => {
  const sampleContent = `# 서론

서론 내용입니다.

## 설치 방법

설치 방법 설명입니다.
자세한 내용이 포함됩니다.

### 요구 사항

요구 사항 목록입니다.

## 사용 방법

사용 방법 설명입니다.

# 결론

결론 내용입니다.`;

  it('존재하는 섹션을 추출한다', () => {
    const result = extractSection(sampleContent, '설치 방법');
    expect(result).not.toBeNull();
    expect(result).toContain('설치 방법 설명입니다.');
    expect(result).toContain('자세한 내용이 포함됩니다.');
    expect(result).toContain('요구 사항');
    expect(result).not.toContain('사용 방법 설명입니다.');
  });

  it('하위 섹션을 추출한다', () => {
    const result = extractSection(sampleContent, '요구 사항');
    expect(result).not.toBeNull();
    expect(result).toContain('요구 사항 목록입니다.');
    expect(result).not.toContain('설치 방법 설명입니다.');
  });

  it('존재하지 않는 섹션에 대해 null을 반환한다', () => {
    const result = extractSection(sampleContent, '존재하지 않는 섹션');
    expect(result).toBeNull();
  });

  it('마지막 섹션을 추출한다 (종료 Heading 없음)', () => {
    const result = extractSection(sampleContent, '결론');
    expect(result).not.toBeNull();
    expect(result).toContain('결론 내용입니다.');
  });

  it('동급 Heading에서 종료한다', () => {
    // '설치 방법'(##)은 '사용 방법'(##, 동급)에서 종료됨
    const result = extractSection(sampleContent, '설치 방법');
    expect(result).not.toBeNull();
    expect(result).toContain('설치 방법 설명입니다.');
    expect(result).toContain('요구 사항'); // 하위 섹션 포함
    expect(result).not.toContain('사용 방법 설명입니다.'); // 동급에서 종료
  });
});

describe('isNonWordToken (MS Word 스타일)', () => {
  it('순수 숫자는 비단어다', () => {
    expect(isNonWordToken('2025')).toBe(true);
    expect(isNonWordToken('4096')).toBe(true);
    expect(isNonWordToken('123')).toBe(true);
    expect(isNonWordToken('0.5')).toBe(true);
  });

  it('순수 기호는 비단어다', () => {
    expect(isNonWordToken('/')).toBe(true);
    expect(isNonWordToken('->')).toBe(true);
    expect(isNonWordToken('&')).toBe(true);
    expect(isNonWordToken('→')).toBe(true);
    expect(isNonWordToken('x')).toBe(true);  // 4096 x 4096의 x
  });

  it('기술 용어는 단어다 (MS Word처럼)', () => {
    // 파일 확장자 - 단어로 카운트
    expect(isNonWordToken('.max')).toBe(false);
    expect(isNonWordToken('.fbx')).toBe(false);
    // 파일명 - 단어로 카운트
    expect(isNonWordToken('Spur.Max')).toBe(false);
    expect(isNonWordToken('SK_Spur.fbx')).toBe(false);
    // 약어 - 단어로 카운트
    expect(isNonWordToken('UV')).toBe(false);
    expect(isNonWordToken('FBX')).toBe(false);
    expect(isNonWordToken('RGBA')).toBe(false);
    // 기술 식별자 - 단어로 카운트
    expect(isNonWordToken('3ds')).toBe(false);
    expect(isNonWordToken('T_Spur_D')).toBe(false);
    expect(isNonWordToken('70K')).toBe(false);
  });

  it('일반 영어 단어는 단어다', () => {
    expect(isNonWordToken('Hello')).toBe(false);
    expect(isNonWordToken('vehicle')).toBe(false);
    expect(isNonWordToken('the')).toBe(false);
  });

  it('문장부호가 붙어도 정상 처리한다', () => {
    expect(isNonWordToken('vehicles.')).toBe(false);
    expect(isNonWordToken('4096,')).toBe(true);  // 숫자
    expect(isNonWordToken('(UV)')).toBe(false);  // 약어는 단어
  });
});

describe('countByLanguage', () => {
  it('영어 단어를 카운팅한다', () => {
    const text = 'Hello world, this is a test!';
    const result = countByLanguage(text);
    expect(result.english).toBe(6); // Hello, world, this, is, a, test (6단어)
  });

  it('한국어 단어를 카운팅한다 (공백 구분)', () => {
    const text = '안녕하세요 반갑습니다';
    const result = countByLanguage(text);
    expect(result.korean).toBe(2); // 안녕하세요, 반갑습니다 (2단어)
  });

  it('혼합 언어를 각각 카운팅한다', () => {
    const text = 'Hello 안녕하세요 world';
    const result = countByLanguage(text);
    expect(result.english).toBe(2); // Hello, world (2단어)
    expect(result.korean).toBe(1);   // 안녕하세요 (1단어)
  });

  it('중국어 단어를 카운팅한다', () => {
    const text = '你好 世界';
    const result = countByLanguage(text);
    expect(result.chinese).toBe(2); // 你好, 世界 (2단어)
  });

  it('일본어 단어를 카운팅한다', () => {
    const text = 'こんにちは さようなら';
    const result = countByLanguage(text);
    expect(result.japanese).toBe(2); // こんにちは, さようなら (2단어)
  });

  it('숫자만 있는 텍스트는 언어별 카운트에 포함되지 않는다', () => {
    const text = '123 456';
    const result = countByLanguage(text);
    expect(result.english).toBe(0);
    expect(result.korean).toBe(0);
  });

  it('코드 블록 내용은 제외한다', () => {
    const text = 'Hello ```const korean = "한글"``` World';
    const result = countByLanguage(text);
    expect(result.english).toBe(2); // Hello, World만
    expect(result.korean).toBe(0);  // 코드 블록 내 한글 제외
  });

  it('빈 문자열을 처리한다', () => {
    const result = countByLanguage('');
    expect(result).toEqual({
      english: 0,
      korean: 0,
      chinese: 0,
      japanese: 0,
    });
  });

  it('excludeTechnical 옵션으로 순수 숫자/기호만 제외한다 (MS Word 스타일)', () => {
    const text = 'Use 3ds Max to create files at 4096 x 4096';
    const withAll = countByLanguage(text, { excludeTechnical: false });
    const withoutNonWords = countByLanguage(text, { excludeTechnical: true });

    // 전체: Use, 3ds, Max, to, create, files, at, 4096, x, 4096 중 영어만
    expect(withAll.english).toBe(8);  // Use, 3ds, Max, to, create, files, at, x
    // 비단어 제외: 4096, x, 4096 제외
    expect(withoutNonWords.english).toBe(7);  // Use, 3ds, Max, to, create, files, at
  });

  it('기술 용어(파일명, 약어)는 단어로 카운트한다', () => {
    const text = 'Export Spur.Max as SK_Spur.fbx with UV mapping';
    const result = countByLanguage(text, { excludeTechnical: true });
    // Export, Spur.Max, as, SK_Spur.fbx, with, UV, mapping 모두 단어
    expect(result.english).toBe(7);
  });
});

describe('calculateTotal', () => {
  const breakdown: WordCountBreakdown = {
    english: 100,
    korean: 50,
    chinese: 30,
    japanese: 20,
  };

  it('all 필터: 언어별 합산', () => {
    expect(calculateTotal(breakdown, 'all')).toBe(200);
  });

  it('english 필터: 영어만', () => {
    expect(calculateTotal(breakdown, 'english')).toBe(100);
  });

  it('korean 필터: 한국어만', () => {
    expect(calculateTotal(breakdown, 'korean')).toBe(50);
  });

  it('chinese 필터: 중국어만', () => {
    expect(calculateTotal(breakdown, 'chinese')).toBe(30);
  });

  it('japanese 필터: 일본어만', () => {
    expect(calculateTotal(breakdown, 'japanese')).toBe(20);
  });

  it('cjk 필터: 한중일 합산', () => {
    expect(calculateTotal(breakdown, 'cjk')).toBe(100); // 50 + 30 + 20
  });
});

describe('extractPageIdFromUrl', () => {
  it('Confluence URL에서 페이지 ID를 추출한다', () => {
    const url = 'https://mycompany.atlassian.net/wiki/spaces/DEV/pages/123456789/My+Page+Title';
    expect(extractPageIdFromUrl(url)).toBe('123456789');
  });

  it('숫자 ID를 그대로 반환한다', () => {
    expect(extractPageIdFromUrl('123456789')).toBe('123456789');
  });

  it('공백이 포함된 숫자 ID를 처리한다', () => {
    expect(extractPageIdFromUrl('  123456789  ')).toBe('123456789');
  });

  it('유효하지 않은 입력에 대해 에러를 발생시킨다', () => {
    expect(() => extractPageIdFromUrl('not-a-valid-input')).toThrow();
    expect(() => extractPageIdFromUrl('https://example.com/something')).toThrow();
  });
});

describe('countWords', () => {
  it('전체 콘텐츠를 카운팅한다', () => {
    const content = 'Hello world 안녕하세요';
    const result = countWords(content);
    expect(result.totalWords).toBe(3); // Hello, world, 안녕하세요 (3단어)
    expect(result.breakdown.english).toBe(2); // Hello, world (2단어)
    expect(result.breakdown.korean).toBe(1);   // 안녕하세요 (1단어)
  });

  it('언어 필터를 적용한다 (영어)', () => {
    const content = 'Hello world 안녕하세요';
    const result = countWords(content, { language: 'english' });
    expect(result.totalWords).toBe(2); // 영어 단어 수
  });

  it('언어 필터를 적용한다 (한국어)', () => {
    const content = 'Hello world 안녕하세요';
    const result = countWords(content, { language: 'korean' });
    expect(result.totalWords).toBe(1); // 한국어 단어 수
  });

  it('표 안의 텍스트를 포함한다', () => {
    const content = '<table><tr><td>First</td><td>Second</td></tr><tr><td>Third</td><td>Fourth</td></tr></table>';
    const result = countWords(content);
    // stripHtml이 </td>, </th> 뒤에 공백을 추가하여 셀 텍스트가 분리됨
    expect(result.totalWords).toBe(4);
  });

  it('섹션 필터를 적용한다', () => {
    const content = `# Introduction

This is intro.

## Details

These are the details with some words.`;
    const result = countWords(content, { sectionHeading: 'Details' });
    expect(result.sectionTitle).toBe('Details');
    expect(result.breakdown.english).toBeGreaterThan(0);
  });

  it('존재하지 않는 섹션에 대해 0을 반환한다', () => {
    const content = '# Test\nSome content';
    const result = countWords(content, { sectionHeading: 'NonExistent' });
    expect(result.totalWords).toBe(0);
    expect(result.sectionTitle).toBe('NonExistent');
  });

  it('excludeTechnical 옵션으로 순수 숫자/기호만 제외한다', () => {
    const content = 'High poly model at 4096 / 2048 resolution';
    const withAll = countWords(content, { excludeTechnical: false });
    const withoutNonWords = countWords(content, { excludeTechnical: true });

    // 전체 토큰: High, poly, model, at, 4096, /, 2048, resolution
    expect(withAll.totalWords).toBe(8);
    // 비단어(숫자/기호) 제외: 4096, /, 2048 제외
    expect(withoutNonWords.totalWords).toBe(5);
    expect(withoutNonWords.breakdown.english).toBe(5);
  });

  it('기술 용어는 MS Word처럼 단어로 카운트한다', () => {
    const content = 'Use 3ds Max with UV mapping and .fbx export';
    const result = countWords(content, { excludeTechnical: true });

    // 모든 기술 용어(3ds, UV, .fbx)가 단어로 카운트됨
    // Use, 3ds, Max, with, UV, mapping, and, .fbx, export = 9단어
    expect(result.breakdown.english).toBe(9);
  });

  it('contentType="table"로 표 안의 내용만 카운팅한다', () => {
    const content = `# Weekly Progress

Some intro text here.

| Task | Status |
|------|--------|
| Design | Complete |
| Development | In progress |

More text after.`;

    const tableOnly = countWords(content, { contentType: 'table' });
    const allContent = countWords(content, { contentType: 'all' });

    // 표만: Task, Status, Design, Complete, Development, In, progress = 7단어
    expect(tableOnly.breakdown.english).toBe(7);
    // 전체는 더 많아야 함
    expect(allContent.breakdown.english).toBeGreaterThan(tableOnly.breakdown.english);
  });

  it('contentType="text"로 표 제외한 텍스트만 카운팅한다', () => {
    const content = `# Title

Intro paragraph here.

| Col A | Col B |
|-------|-------|
| Data1 | Data2 |

Conclusion paragraph.`;

    const textOnly = countWords(content, { contentType: 'text' });
    const allContent = countWords(content, { contentType: 'all' });

    // 표 제외: Title, Intro, paragraph, here, Conclusion, paragraph = 6단어
    expect(textOnly.breakdown.english).toBe(6);
    // 전체는 더 많아야 함
    expect(allContent.breakdown.english).toBeGreaterThan(textOnly.breakdown.english);
  });

  it('sectionHeading + contentType 조합이 작동한다', () => {
    const content = `# Overview

Overview text here.

# Weekly Progress

Progress intro.

| Task | Owner |
|------|-------|
| Review | Alice |
| Test | Bob |

Progress summary.`;

    const result = countWords(content, {
      sectionHeading: 'Weekly Progress',
      contentType: 'table',
    });

    // Weekly Progress 섹션의 표만: Task, Owner, Review, Alice, Test, Bob = 6단어
    expect(result.breakdown.english).toBe(6);
  });

  it('untilSection으로 해당 섹션 전까지만 카운팅한다', () => {
    const content = `# Introduction

This is intro with five words.

## Details

Details section has more content here.

## Conclusion

Final words.`;

    const result = countWords(content, { untilSection: 'Details' });

    // Introduction 섹션만: Introduction, This, is, intro, with, five, words = 7단어
    expect(result.breakdown.english).toBe(7);
  });

  it('untilSection이 없으면 전체 카운팅한다', () => {
    const content = `# Intro

Some words here.

## Section

More words.`;

    const withUntil = countWords(content, { untilSection: 'Section' });
    const withoutUntil = countWords(content);

    expect(withoutUntil.totalWords).toBeGreaterThan(withUntil.totalWords);
  });
});

describe('aggregateResults', () => {
  it('여러 페이지 결과를 합산한다', () => {
    const results: PageWordCountResult[] = [
      {
        pageId: '1',
        result: {
          totalWords: 100,
          breakdown: { english: 50, korean: 30, chinese: 10, japanese: 10 },
        },
      },
      {
        pageId: '2',
        result: {
          totalWords: 50,
          breakdown: { english: 20, korean: 20, chinese: 5, japanese: 5 },
        },
      },
    ];

    const aggregated = aggregateResults(results);
    expect(aggregated.totalWords).toBe(150);
    expect(aggregated.breakdown.english).toBe(70);
    expect(aggregated.breakdown.korean).toBe(50);
  });

  it('에러가 있는 페이지를 건너뛴다', () => {
    const results: PageWordCountResult[] = [
      {
        pageId: '1',
        result: {
          totalWords: 100,
          breakdown: { english: 100, korean: 0, chinese: 0, japanese: 0 },
        },
      },
      {
        pageId: '2',
        result: {
          totalWords: 0,
          breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        },
        error: 'Page not found',
      },
    ];

    const aggregated = aggregateResults(results);
    expect(aggregated.totalWords).toBe(100);
  });

  it('필터를 적용하여 합산한다', () => {
    const results: PageWordCountResult[] = [
      {
        pageId: '1',
        result: {
          totalWords: 100,
          breakdown: { english: 50, korean: 30, chinese: 10, japanese: 10 },
        },
      },
      {
        pageId: '2',
        result: {
          totalWords: 50,
          breakdown: { english: 20, korean: 20, chinese: 5, japanese: 5 },
        },
      },
    ];

    const koreanOnly = aggregateResults(results, 'korean');
    expect(koreanOnly.totalWords).toBe(50); // 30 + 20
  });
});

describe('formatWordCountResult', () => {
  it('all 필터 결과를 포맷팅한다', () => {
    const result = {
      totalWords: 100,
      breakdown: { english: 40, korean: 30, chinese: 20, japanese: 10 },
    };
    const formatted = formatWordCountResult(result, 'all');
    expect(formatted).toContain('총 단어 수: 100');
    expect(formatted).toContain('영어: 40');
    expect(formatted).toContain('한국어: 30');
  });

  it('english 필터 결과를 포맷팅한다', () => {
    const result = {
      totalWords: 40,
      breakdown: { english: 40, korean: 30, chinese: 20, japanese: 10 },
    };
    const formatted = formatWordCountResult(result, 'english');
    expect(formatted).toContain('영어: 40 단어');
  });

  it('섹션 제목을 포함한다', () => {
    const result = {
      totalWords: 50,
      breakdown: { english: 50, korean: 0, chinese: 0, japanese: 0 },
      sectionTitle: 'Introduction',
    };
    const formatted = formatWordCountResult(result, 'all');
    expect(formatted).toContain('섹션: "Introduction"');
  });
});

describe('formatMultiPageResults', () => {
  it('여러 페이지 결과를 포맷팅한다', () => {
    const results: PageWordCountResult[] = [
      {
        pageId: '123',
        result: {
          totalWords: 100,
          breakdown: { english: 100, korean: 0, chinese: 0, japanese: 0 },
        },
      },
      {
        pageId: '456',
        result: {
          totalWords: 50,
          breakdown: { english: 50, korean: 0, chinese: 0, japanese: 0 },
        },
      },
    ];

    const formatted = formatMultiPageResults(results, 'english');
    expect(formatted).toContain('페이지 123');
    expect(formatted).toContain('페이지 456');
    expect(formatted).toContain('전체 합계');
  });

  it('에러가 있는 페이지를 표시한다', () => {
    const results: PageWordCountResult[] = [
      {
        pageId: '123',
        result: {
          totalWords: 100,
          breakdown: { english: 100, korean: 0, chinese: 0, japanese: 0 },
        },
      },
      {
        pageId: '456',
        result: {
          totalWords: 0,
          breakdown: { english: 0, korean: 0, chinese: 0, japanese: 0 },
        },
        error: 'Page not found',
      },
    ];

    const formatted = formatMultiPageResults(results, 'all');
    expect(formatted).toContain('❌ 페이지 456: Page not found');
  });

  it('단일 페이지일 때 합계를 표시하지 않는다', () => {
    const results: PageWordCountResult[] = [
      {
        pageId: '123',
        result: {
          totalWords: 100,
          breakdown: { english: 100, korean: 0, chinese: 0, japanese: 0 },
        },
      },
    ];

    const formatted = formatMultiPageResults(results, 'all');
    expect(formatted).not.toContain('전체 합계');
  });
});
