/**
 * chatStore.helpers 순수 함수 테스트
 * - inferSuggestionFromAssistantText: rule/context 트리거 검증
 * - createIncrementalGhostRestorer: 스트리밍 증분 ghost chip 복원 (P3)
 */
import { describe, it, expect } from 'vitest';
import {
  createIncrementalGhostRestorer,
  inferSuggestionFromAssistantText,
  mergePersonaIntoRules,
} from './chatStore.helpers';
import { restoreGhostChips, type GhostMaskSession } from '@/utils/ghostMask';

describe('inferSuggestionFromAssistantText', () => {
  describe('rule/context 트리거', () => {
    it('[Add to Rules] 마커로 suggestedRule 반환', () => {
      const text = '영문 대문자 통일 [Add to Rules]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedRule).toBeDefined();
    });

    it('[Add to Context] 마커로 suggestedContext 반환', () => {
      const text = '이 프로젝트는 SaaS 플랫폼입니다 [Add to Context]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedContext).toBeDefined();
    });
  });

  describe('복합 트리거', () => {
    it('Rule + Context 동시 감지', () => {
      const text = '영문 소문자 통일 [Add to Rules] SaaS 프로젝트 [Add to Context]';
      const result = inferSuggestionFromAssistantText(text);
      expect(result).not.toBeNull();
      expect(result!.suggestedRule).toBeDefined();
      expect(result!.suggestedContext).toBeDefined();
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

  });
});

describe('mergePersonaIntoRules', () => {
  it('legacy persona를 기존 규칙 앞에 병합한다', () => {
    expect(mergePersonaIntoRules('게임 번역 전문가', '고유명사는 음차')).toBe(
      '게임 번역 전문가\n\n고유명사는 음차',
    );
  });

  it('이미 포함된 persona는 중복 추가하지 않는다', () => {
    expect(mergePersonaIntoRules('게임 번역 전문가', '게임 번역 전문가\n\n고유명사는 음차')).toBe(
      '게임 번역 전문가\n\n고유명사는 음차',
    );
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
