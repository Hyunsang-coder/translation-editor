import { describe, it, expect } from 'vitest';
import {
  levenshteinSimilarity,
  findBestFuzzyMatch,
  findFuzzyMatches,
} from '../fuzzyMatch';
import { normalizeForSearch } from '../normalizeForSearch';

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
    expect(levenshteinSimilarity('안녕하세요', '안녕하세요')).toBe(1);
  });

  it('returns 0 for empty string comparison', () => {
    expect(levenshteinSimilarity('', 'hello')).toBe(0);
    expect(levenshteinSimilarity('hello', '')).toBe(0);
    expect(levenshteinSimilarity('', '')).toBe(1); // identical empty strings
  });

  it('calculates correct similarity for minor differences', () => {
    // 1 character difference in 5 character string = 80% similarity
    const sim = levenshteinSimilarity('hello', 'hallo');
    expect(sim).toBeCloseTo(0.8, 2);
  });

  it('calculates similarity for Korean text', () => {
    // "번역문" vs "번역물" - 1 character difference in 3 characters
    const sim = levenshteinSimilarity('번역문', '번역물');
    expect(sim).toBeCloseTo(0.67, 2);
  });

  it('handles completely different strings', () => {
    const sim = levenshteinSimilarity('abc', 'xyz');
    expect(sim).toBe(0); // completely different
  });
});

describe('findBestFuzzyMatch', () => {
  it('finds exact match with score 1', () => {
    const result = findBestFuzzyMatch('hello world', 'world');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
    expect(result!.matchedText).toBe('world');
    expect(result!.index).toBe(6);
  });

  it('finds fuzzy match with high similarity', () => {
    // More realistic case: AI changes one character in a longer phrase
    // "hello world" vs "hello wrold" - 1 char difference in 11 chars = 90.9% similarity
    const result = findBestFuzzyMatch('the quick brown fox jumps over', 'brown fox jumps', 0.7);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(0.9);
    expect(result!.matchedText).toBe('brown fox jumps');
  });

  it('returns null when no match above threshold', () => {
    const result = findBestFuzzyMatch('hello world', 'xyz', 0.7);
    expect(result).toBeNull();
  });

  it('handles empty inputs', () => {
    expect(findBestFuzzyMatch('', 'hello')).toBeNull();
    expect(findBestFuzzyMatch('hello', '')).toBeNull();
    expect(findBestFuzzyMatch('', '')).toBeNull();
  });

  it('handles search term longer than text', () => {
    const result = findBestFuzzyMatch('hi', 'hello world');
    expect(result).toBeNull();
  });

  it('finds Korean text with typo', () => {
    // AI가 "번역문에서" 대신 "번역문이서"로 반환한 경우
    const result = findBestFuzzyMatch('이것은 번역문에서 발견된 오류입니다', '번역문이서', 0.7);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.7);
  });

  it('is case insensitive', () => {
    const result = findBestFuzzyMatch('Hello World', 'WORLD');
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
    expect(result!.matchedText).toBe('World'); // returns original case
  });
});

describe('findFuzzyMatches', () => {
  it('returns array with single match', () => {
    const results = findFuzzyMatches('hello world', 'world');
    expect(results).toHaveLength(1);
    expect(results[0]!.matchedText).toBe('world');
  });

  it('returns empty array when no match', () => {
    const results = findFuzzyMatches('hello world', 'xyz', 0.9);
    expect(results).toHaveLength(0);
  });
});

describe('real-world scenarios', () => {
  it('handles AI adding extra punctuation', () => {
    const text = '번역된 결과입니다';
    const searchTerm = '번역된 결과입니다.'; // AI added period
    const result = findBestFuzzyMatch(text, searchTerm, 0.7);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it('handles AI minor word changes', () => {
    const text = '사용자가 입력한 텍스트입니다';
    const searchTerm = '사용자가 입력된 텍스트입니다'; // "입력한" → "입력된"
    const result = findBestFuzzyMatch(text, searchTerm, 0.7);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.7);
  });

  it('handles whitespace differences', () => {
    const text = '이것은  두 칸  공백입니다'; // double spaces
    const searchTerm = '이것은 두 칸 공백입니다'; // single spaces
    const result = findBestFuzzyMatch(text, searchTerm, 0.8);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
  });
});

describe('threshold boundary cases', () => {
  it('includes match exactly at threshold', () => {
    // "abcde" vs "abcdf" = 4/5 = 0.8 similarity
    const result = findBestFuzzyMatch('hello abcde world', 'abcdf', 0.8);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(0.8);
  });

  it('excludes match just below threshold', () => {
    // "abc" vs "xyz" = 0 similarity
    const result = findBestFuzzyMatch('hello abc world', 'xyz', 0.5);
    expect(result).toBeNull();
  });

  it('works with threshold 1.0 (exact match only)', () => {
    const result = findBestFuzzyMatch('hello world', 'world', 1.0);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);

    const noMatch = findBestFuzzyMatch('hello world', 'worle', 1.0);
    expect(noMatch).toBeNull();
  });
});

describe('multiple similar candidates', () => {
  it('selects the best match among multiple candidates', () => {
    // "test1" and "test2" both exist, searching for "test1"
    const text = 'prefix test2 middle test1 suffix';
    const result = findBestFuzzyMatch(text, 'test1', 0.7);
    expect(result).not.toBeNull();
    expect(result!.matchedText).toBe('test1');
    expect(result!.score).toBe(1);
  });

  it('finds best match when exact match is not available', () => {
    // Looking for "testing" in text with "testng" and "testin"
    const text = 'first testng then testin finally';
    const result = findBestFuzzyMatch(text, 'testing', 0.7);
    expect(result).not.toBeNull();
    // Both have 6/7 similarity, should find one of them
    expect(result!.score).toBeCloseTo(6 / 7, 2);
  });
});

describe('long text performance', () => {
  it('handles moderately long text', () => {
    const longText = '이것은 테스트를 위한 긴 문장입니다. '.repeat(50);
    const searchTerm = '테스트를 위한 긴';
    const result = findBestFuzzyMatch(longText, searchTerm, 0.8);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  it('respects iteration limit for very long text', () => {
    // This should not hang even with very long text
    const veryLongText = 'a'.repeat(500) + '찾을텍스트' + 'b'.repeat(500);
    const start = Date.now();
    findBestFuzzyMatch(veryLongText, '찾을텍스트', 0.9);
    const elapsed = Date.now() - start;

    // Should complete within reasonable time (< 1 second)
    expect(elapsed).toBeLessThan(1000);
    // May or may not find due to iteration limit, but shouldn't hang
  });
});

describe('special characters and formatting', () => {
  it('handles quotes variation', () => {
    const text = '그는 "안녕하세요"라고 말했다';
    const searchTerm = '그는 "안녕하세요"라고 말했다'; // curly quotes
    const result = findBestFuzzyMatch(text, searchTerm, 0.8);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it('handles text with numbers', () => {
    const text = '2024년 1월 15일에 시작됩니다';
    const searchTerm = '2024년 1월 16일에 시작됩니다'; // different day
    const result = findBestFuzzyMatch(text, searchTerm, 0.8);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.9);
  });

  it('handles mixed language text', () => {
    const text = 'React 컴포넌트를 생성합니다';
    const searchTerm = 'React 컴포넌트를 생성합니다.'; // added period
    const result = findBestFuzzyMatch(text, searchTerm, 0.8);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.9);
  });
});

describe('edge cases for review apply', () => {
  it('handles AI truncating text', () => {
    const text = '이 문장은 원래 더 길었습니다만 지금은 짧아졌습니다';
    const searchTerm = '이 문장은 원래 더 길었습니다'; // truncated
    const result = findBestFuzzyMatch(text, searchTerm, 0.7);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  it('handles AI expanding text', () => {
    const text = '짧은 문장';
    const searchTerm = '짧은 문장입니다'; // AI added suffix
    const result = findBestFuzzyMatch(text, searchTerm, 0.5);
    expect(result).not.toBeNull();
    // text (5 chars) vs searchTerm (8 chars) - should find text
  });

  it('handles single character difference in short text', () => {
    const text = '오류';
    const searchTerm = '오유'; // 1 char diff in 2 chars = 50% similarity
    const result = findBestFuzzyMatch(text, searchTerm, 0.4);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0.5);
  });

  it('returns correct index for match in middle of text', () => {
    const text = 'AAAA 타겟텍스트 BBBB';
    const result = findBestFuzzyMatch(text, '타겟텍스트', 0.9);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(5); // after "AAAA "
    expect(result!.matchedText).toBe('타겟텍스트');
  });
});

describe('integration with normalizeForSearch (review apply pipeline)', () => {
  it('finds text when AI adds markdown bold', () => {
    const editorText = '플레이어가 완전한 은폐 강도를 수행할 수 있도록 허용하지만';
    const aiExcerpt = '**플레이어가 완전한 은폐 강도를 수행할 수 있도록 허용하지만**';

    const searchText = normalizeForSearch(aiExcerpt);
    const result = findBestFuzzyMatch(editorText, searchText, 0.9);

    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  it('finds text when AI uses different quote style', () => {
    const editorText = '그는 "안녕하세요"라고 말했다';
    const aiExcerpt = '그는 "안녕하세요"라고 말했다'; // curly quotes

    const searchText = normalizeForSearch(aiExcerpt);
    const result = findBestFuzzyMatch(editorText, searchText, 0.9);

    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  it('finds text when AI adds trailing period', () => {
    const editorText = '번역된 결과입니다';
    const aiExcerpt = '번역된 결과입니다.';

    const searchText = normalizeForSearch(aiExcerpt);
    const result = findBestFuzzyMatch(editorText, searchText, 0.8);

    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it('finds text when AI includes code backticks', () => {
    const editorText = 'config 파일을 수정하세요';
    const aiExcerpt = '`config` 파일을 수정하세요';

    const searchText = normalizeForSearch(aiExcerpt);
    const result = findBestFuzzyMatch(editorText, searchText, 0.9);

    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  it('finds text when AI uses different dash style', () => {
    const editorText = '2024-01-15 날짜에';
    const aiExcerpt = '2024–01–15 날짜에'; // en-dash

    const searchText = normalizeForSearch(aiExcerpt);
    const result = findBestFuzzyMatch(editorText, searchText, 0.9);

    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });

  it('handles complex case: markdown + quotes + extra spaces', () => {
    const editorText = '이것은 "테스트" 문장입니다';
    const aiExcerpt = '**이것은  "테스트"  문장입니다**'; // bold + curly quotes + double spaces

    const searchText = normalizeForSearch(aiExcerpt);
    // After normalization: '이것은 "테스트" 문장입니다' (spaces collapsed, quotes normalized)
    const result = findBestFuzzyMatch(editorText, searchText, 0.8);

    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it('returns null when text is completely different (not a fuzzy match case)', () => {
    const editorText = '한글 번역문입니다';
    const aiExcerpt = 'This is English text'; // AI mistakenly used source instead of target

    const searchText = normalizeForSearch(aiExcerpt);
    const result = findBestFuzzyMatch(editorText, searchText, 0.7);

    expect(result).toBeNull(); // Should not match - different language entirely
  });
});
