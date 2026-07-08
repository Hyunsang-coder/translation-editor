/**
 * chatStore.helpers 순수 함수 테스트
 * - inferSuggestionFromAssistantText: persona 트리거 추가 검증
 * - createIncrementalGhostRestorer: 스트리밍 증분 ghost chip 복원 (P3)
 */
import { describe, it, expect } from 'vitest';
import { inferSuggestionFromAssistantText, createIncrementalGhostRestorer } from './chatStore.helpers';
import { restoreGhostChips, type GhostMaskSession } from '@/utils/ghostMask';

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

describe('createIncrementalGhostRestorer', () => {
  const TOKEN = '⟦ITE_GHOST:test-session:1⟧';
  const VALUE = '{PLAYER_NAME}';

  function makeSession(): GhostMaskSession {
    return {
      tokenToValue: { [TOKEN]: VALUE },
      valueToToken: new Map([[VALUE, TOKEN]]),
    };
  }

  it('토큰이 없는 텍스트는 그대로 통과', () => {
    const restore = createIncrementalGhostRestorer(makeSession());
    expect(restore('안녕')).toBe('안녕');
    expect(restore('안녕하세요')).toBe('안녕하세요');
  });

  it('청크 경계에 걸친 ghost 토큰을 완성 시점에 복원 (미완성 구간은 보류)', () => {
    const restore = createIncrementalGhostRestorer(makeSession());

    // 미완성 토큰: 복원 보류, 원문 그대로 표시
    const partial = `안녕 ${TOKEN.slice(0, 8)}`;
    expect(restore(partial)).toBe(partial);

    // 토큰 완성: 복원됨
    expect(restore(`안녕 ${TOKEN} 님`)).toBe(`안녕 ${VALUE} 님`);
  });

  it('전체 스트림 누적 결과가 restoreGhostChips(full)과 동일', () => {
    const session = makeSession();
    const restore = createIncrementalGhostRestorer(session);
    const full = `첫 문장 ${TOKEN} 중간 텍스트 ${TOKEN} 끝`;

    // 1글자씩 스트리밍 시뮬레이션
    let out = '';
    for (let i = 1; i <= full.length; i++) {
      out = restore(full.slice(0, i));
    }
    expect(out).toBe(restoreGhostChips(full, session));
  });

  it('토큰 최대 길이를 초과한 미닫힘 괄호는 일반 텍스트로 간주', () => {
    const restore = createIncrementalGhostRestorer(makeSession());
    const text = `문장 ⟦${'a'.repeat(120)}`;
    expect(restore(text)).toBe(text);
    // 이후 텍스트가 이어져도 그대로 유지
    expect(restore(`${text} 계속`)).toBe(`${text} 계속`);
  });

  it('누적 텍스트가 리셋되면(도구 호출 스텝 전환 등) 새 텍스트 기준으로 재계산', () => {
    const restore = createIncrementalGhostRestorer(makeSession());
    expect(restore(`이전 스텝 텍스트 ${TOKEN}`)).toBe(`이전 스텝 텍스트 ${VALUE}`);
    // 새 스텝: 누적 텍스트가 줄어듦
    expect(restore('새')).toBe('새');
    expect(restore(`새 스텝 ${TOKEN}`)).toBe(`새 스텝 ${VALUE}`);
  });
});
