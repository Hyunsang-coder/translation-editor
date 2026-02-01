import { describe, it, expect } from 'vitest';
import {
  applyUnicodeNormalization,
  normalizeForSearch,
  stripMarkdownInline,
} from './normalizeForSearch';

describe('applyUnicodeNormalization', () => {
  it('곡선 큰따옴표를 직선 따옴표로 변환한다', () => {
    expect(applyUnicodeNormalization('"hello"')).toBe('"hello"');
    expect(applyUnicodeNormalization('「안녕」')).toBe('"안녕"');
    expect(applyUnicodeNormalization('『세계』')).toBe('"세계"');
  });

  it('곡선 작은따옴표를 직선 따옴표로 변환한다', () => {
    expect(applyUnicodeNormalization('\u2018hello\u2019')).toBe("'hello'");
  });

  it('특수 공백을 일반 공백으로 변환한다', () => {
    expect(applyUnicodeNormalization('hello\u00A0world')).toBe('hello world'); // non-breaking space
    expect(applyUnicodeNormalization('hello\u3000world')).toBe('hello world'); // ideographic space
  });

  it('em-dash, en-dash를 하이픈으로 변환한다', () => {
    expect(applyUnicodeNormalization('hello–world')).toBe('hello-world'); // en-dash
    expect(applyUnicodeNormalization('hello—world')).toBe('hello-world'); // em-dash
  });

  it('문자열 길이를 유지한다 (1:1 치환)', () => {
    const input = '"test"';
    const output = applyUnicodeNormalization(input);
    expect(output.length).toBe(input.length);
  });
});

describe('normalizeForSearch', () => {
  describe('HTML 처리', () => {
    it('HTML 태그를 제거한다', () => {
      expect(normalizeForSearch('<strong>bold</strong>')).toBe('bold');
      expect(normalizeForSearch('<code>code</code>')).toBe('code');
    });

    it('HTML 엔티티를 변환한다', () => {
      expect(normalizeForSearch('hello&nbsp;world')).toBe('hello world');
      expect(normalizeForSearch('&lt;tag&gt;')).toBe('<tag>');
      expect(normalizeForSearch('&amp;')).toBe('&');
    });
  });

  describe('마크다운 서식 제거', () => {
    it('bold 서식을 제거한다', () => {
      expect(normalizeForSearch('**bold**')).toBe('bold');
      expect(normalizeForSearch('__bold__')).toBe('bold');
    });

    it('italic 서식을 제거한다', () => {
      expect(normalizeForSearch('*italic*')).toBe('italic');
      expect(normalizeForSearch('_italic_')).toBe('italic');
    });

    it('strikethrough 서식을 제거한다', () => {
      expect(normalizeForSearch('~~deleted~~')).toBe('deleted');
    });

    it('inline code 서식을 제거한다', () => {
      expect(normalizeForSearch('`code`')).toBe('code');
    });

    it('링크에서 텍스트만 추출한다', () => {
      expect(normalizeForSearch('[링크 텍스트](https://example.com)')).toBe('링크 텍스트');
    });

    it('중첩된 서식을 처리한다', () => {
      expect(normalizeForSearch('**_bold and italic_**')).toBe('bold and italic');
    });

    it('snake_case를 보존한다', () => {
      expect(normalizeForSearch('get_source_documents')).toBe('get_source_documents');
      expect(normalizeForSearch('snake_case_example')).toBe('snake_case_example');
      expect(normalizeForSearch('my_var_name')).toBe('my_var_name');
    });

    it('단어 경계의 _..._ 는 제거하고 intraword _는 보존한다', () => {
      // 단어 경계 이탤릭 → 제거
      expect(normalizeForSearch('_italic_')).toBe('italic');
      expect(normalizeForSearch('hello _world_ there')).toBe('hello world there');
      // snake_case → 보존
      expect(normalizeForSearch('use get_source_documents tool')).toBe(
        'use get_source_documents tool',
      );
    });
  });

  describe('리스트/헤딩 마커 제거', () => {
    it('헤딩 마커를 제거한다', () => {
      expect(normalizeForSearch('# Heading 1')).toBe('Heading 1');
      expect(normalizeForSearch('### Heading 3')).toBe('Heading 3');
    });

    it('순서 없는 리스트 마커를 제거한다', () => {
      expect(normalizeForSearch('- item')).toBe('item');
      expect(normalizeForSearch('* item')).toBe('item');
      expect(normalizeForSearch('+ item')).toBe('item');
    });

    it('순서 있는 리스트 마커를 제거한다', () => {
      expect(normalizeForSearch('1. first')).toBe('first');
      expect(normalizeForSearch('10. tenth')).toBe('tenth');
    });
  });

  describe('공백 정규화', () => {
    it('연속 공백을 단일 공백으로 변환한다', () => {
      expect(normalizeForSearch('hello    world')).toBe('hello world');
    });

    it('줄바꿈을 공백으로 변환한다', () => {
      expect(normalizeForSearch('hello\nworld')).toBe('hello world');
      expect(normalizeForSearch('hello\r\nworld')).toBe('hello world');
    });

    it('앞뒤 공백을 제거한다', () => {
      expect(normalizeForSearch('  hello  ')).toBe('hello');
    });
  });

  describe('복합 케이스', () => {
    it('AI 응답 형식의 excerpt를 정규화한다', () => {
      const aiExcerpt = '**"테스트"** 문장입니다.';
      expect(normalizeForSearch(aiExcerpt)).toBe('"테스트" 문장입니다.');
    });
  });
});

describe('stripMarkdownInline', () => {
  it('인라인 마크다운만 제거하고 리스트/헤딩은 유지한다', () => {
    expect(stripMarkdownInline('# **Heading**')).toBe('# Heading');
    expect(stripMarkdownInline('- *item*')).toBe('- item');
  });

  it('링크에서 텍스트만 추출한다', () => {
    expect(stripMarkdownInline('[example](https://example.com)')).toBe('example');
  });
});
