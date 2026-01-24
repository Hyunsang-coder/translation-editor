import { describe, it, expect } from 'vitest';
import { cleanSuggestionContent } from './cleanSuggestionContent';

describe('cleanSuggestionContent', () => {
  describe('마크다운 포맷팅 제거', () => {
    it('볼드(**) 제거', () => {
      expect(cleanSuggestionContent('**LangChain**')).toBe('LangChain');
      expect(cleanSuggestionContent('**Deep Agent**: 에이전트')).toBe('Deep Agent: 에이전트');
    });

    it('이탤릭(*) 제거', () => {
      expect(cleanSuggestionContent('*강조*')).toBe('강조');
      expect(cleanSuggestionContent('이것은 *중요한* 내용')).toBe('이것은 중요한 내용');
    });

    it('인라인 코드(`) 제거', () => {
      expect(cleanSuggestionContent('`코드`')).toBe('코드');
      expect(cleanSuggestionContent('함수 `getName()` 호출')).toBe('함수 getName() 호출');
    });

    it('복합 마크다운 제거', () => {
      expect(cleanSuggestionContent('**볼드** and *이탤릭* and `코드`')).toBe(
        '볼드 and 이탤릭 and 코드'
      );
    });
  });

  describe('엣지 케이스', () => {
    it('빈 문자열 처리', () => {
      expect(cleanSuggestionContent('')).toBe('');
    });

    it('null/undefined 처리', () => {
      expect(cleanSuggestionContent(null as unknown as string)).toBe('');
      expect(cleanSuggestionContent(undefined as unknown as string)).toBe('');
    });

    it('공백만 있는 문자열', () => {
      expect(cleanSuggestionContent('   ')).toBe('');
    });

    it('마크다운 없는 일반 텍스트', () => {
      expect(cleanSuggestionContent('일반 텍스트')).toBe('일반 텍스트');
    });

    it('앞뒤 공백 제거', () => {
      expect(cleanSuggestionContent('  **볼드**  ')).toBe('볼드');
    });
  });

  describe('실제 AI 응답 시나리오', () => {
    it('번역 규칙 제안', () => {
      const aiResponse = '**합니다체**로 통일; **고유명사**는 음차';
      expect(cleanSuggestionContent(aiResponse)).toBe('합니다체로 통일; 고유명사는 음차');
    });

    it('컨텍스트 제안', () => {
      const aiResponse = '**SF 게임** UI 번역; 타겟: *20-30대* 게이머';
      expect(cleanSuggestionContent(aiResponse)).toBe('SF 게임 UI 번역; 타겟: 20-30대 게이머');
    });

    it('코드 포함 제안', () => {
      const aiResponse = '`API` 용어는 그대로 유지; `SDK`도 마찬가지';
      expect(cleanSuggestionContent(aiResponse)).toBe('API 용어는 그대로 유지; SDK도 마찬가지');
    });
  });
});
