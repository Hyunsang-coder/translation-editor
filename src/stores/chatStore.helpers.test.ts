/**
 * chatStore.helpers 순수 함수 테스트
 * - inferSuggestionFromAssistantText: persona 트리거 추가 검증
 */
import { describe, it, expect } from 'vitest';
import { inferSuggestionFromAssistantText } from './chatStore.helpers';

describe('inferSuggestionFromAssistantText', () => {
  // --- Persona 트리거 ---
  describe('persona 트리거', () => {
    it('[Add to Persona] 명시적 마커가 있으면 suggestedPersona를 반환', () => {
      const text = 'IT 전문 한영 번역가; 자연스러운 구어체 선호 [Add to Persona]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedPersona).toBeDefined();
      expect(result!.suggestedPersona).toContain('IT 전문 한영 번역가');
    });

    it('한국어 트리거 "원하시면 버튼을 ... 페르소나"로 감지', () => {
      const text = '게임 로컬라이저; 10년 경력\n원하시면 버튼을 눌러 페르소나에 추가하세요';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedPersona).toBeDefined();
    });

    it('"필요하시면 [Add to Persona]" 패턴 감지', () => {
      const text = '의료 전문 번역가\n필요하시면 [Add to Persona] 버튼을 눌러 페르소나에 저장하세요';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedPersona).toBeDefined();
    });

    it('persona 트리거만 있으면 suggestedRule/suggestedContext는 없음', () => {
      const text = 'IT 전문 번역가 [Add to Persona]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedPersona).toBeDefined();
      expect(result!.suggestedRule).toBeUndefined();
      expect(result!.suggestedContext).toBeUndefined();
    });
  });

  // --- 기존 트리거 회귀 ---
  describe('기존 rule/context 트리거 회귀', () => {
    it('[Add to Rules] 마커로 suggestedRule 반환', () => {
      const text = '영문 대문자 통일 [Add to Rules]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedRule).toBeDefined();
      expect(result!.suggestedPersona).toBeUndefined();
    });

    it('[Add to Context] 마커로 suggestedContext 반환', () => {
      const text = '이 프로젝트는 SaaS 플랫폼입니다 [Add to Context]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedContext).toBeDefined();
      expect(result!.suggestedPersona).toBeUndefined();
    });
  });

  // --- 복합 트리거 ---
  describe('복합 트리거', () => {
    it('Rule + Persona 동시 감지', () => {
      const text = '영문 소문자 통일 [Add to Rules] [Add to Persona]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedRule).toBeDefined();
      expect(result!.suggestedPersona).toBeDefined();
    });
  });

  // --- 미감지 케이스 ---
  describe('미감지 (오탐 방지)', () => {
    it('트리거 키워드 없는 일반 텍스트는 null', () => {
      const result = inferSuggestionFromAssistantText('번역이 완료되었습니다.');
      expect(result).toBeNull();
    });

    it('빈 문자열은 null', () => {
      expect(inferSuggestionFromAssistantText('')).toBeNull();
    });

    it('"페르소나"만 언급하고 트리거 패턴 없으면 null', () => {
      const result = inferSuggestionFromAssistantText('페르소나 설정을 확인해보세요.');
      expect(result).toBeNull();
    });
  });
});
