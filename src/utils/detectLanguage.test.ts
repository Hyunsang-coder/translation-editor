/**
 * detectLanguage.ts 자동 방향 결정 단위 테스트
 *
 * 수동 타겟 언어 선택이 원문과 같은 언어로 남아 번역이 자기복사가 되던 문제를 막는 층이라,
 * 실패 모드(국문 원문 + 타겟 한국어)와 오탐 위험(영어 용어 범벅 국문, 일본어·중국어)을 함께 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
  AUTO_TARGET_LANGUAGE,
  detectSourceLangCode,
  isSameLanguage,
  normalizeLang,
  resolveTargetLanguage,
} from './detectLanguage';

describe('normalizeLang', () => {
  it('한글 라벨과 영문명을 같은 코드로 정규화한다', () => {
    expect(normalizeLang('한국어')).toBe('ko');
    expect(normalizeLang('Korean')).toBe('ko');
    expect(normalizeLang('영어')).toBe('en');
    expect(normalizeLang('English')).toBe('en');
  });

  it('모르는 언어·빈 값은 null', () => {
    expect(normalizeLang('원문')).toBeNull();
    expect(normalizeLang('')).toBeNull();
    expect(normalizeLang(null)).toBeNull();
  });
});

describe('isSameLanguage', () => {
  it('표기 체계가 달라도 같은 언어를 잡아낸다 (가드의 핵심)', () => {
    expect(isSameLanguage('Korean', '한국어')).toBe(true);
    expect(isSameLanguage('English', '영어')).toBe(true);
  });

  it('다른 언어이거나 한쪽이 판별 불가면 false', () => {
    expect(isSameLanguage('Korean', '영어')).toBe(false);
    expect(isSameLanguage('원문', '한국어')).toBe(false);
    expect(isSameLanguage(null, '한국어')).toBe(false);
  });
});

describe('detectSourceLangCode', () => {
  it('평범한 국문·영문 문서를 가른다', () => {
    expect(detectSourceLangCode('이번 업데이트에서 보급 상자 스폰 규칙을 변경합니다.')).toBe('ko');
    expect(detectSourceLangCode('This update changes the care package spawn rules.')).toBe('en');
  });

  it('영어 용어가 범벅인 국문 문서도 ko — 비율이 아니라 한글 존재를 본다', () => {
    // detectSourceLanguage(한글 30% 임계)로는 '원문'이 나오는 구간
    const text =
      'Skeletal Gear Master Material 전환은 MS2에서 진행하고, ' +
      'Nudebody 2.0 body rework outsourcing scope는 Certain Affinity(CA)와 확정. ' +
      'LOD/collision budget, texture streaming pool, replication cost 검토 필요.';
    expect(detectSourceLangCode(text)).toBe('ko');
  });

  it('일본어·중국어는 자동 결정하지 않는다 (명시 선택 요구)', () => {
    expect(detectSourceLangCode('このアップデートで補給箱の仕様を変更します。')).toBeNull();
    expect(detectSourceLangCode('本次更新调整了补给箱的生成规则。')).toBeNull();
  });

  it('판단 재료가 없으면 null', () => {
    expect(detectSourceLangCode('')).toBeNull();
    expect(detectSourceLangCode('   \n  ')).toBeNull();
    expect(detectSourceLangCode('123 456 / 789')).toBeNull();
  });
});

describe('resolveTargetLanguage', () => {
  it('자동이면 원문의 반대 언어로 푼다', () => {
    expect(resolveTargetLanguage(AUTO_TARGET_LANGUAGE, '보급 상자 스폰 규칙')).toEqual({
      language: '영어',
      auto: true,
    });
    expect(resolveTargetLanguage(AUTO_TARGET_LANGUAGE, 'Care package spawn rules')).toEqual({
      language: '한국어',
      auto: true,
    });
  });

  it('미설정(빈 값)도 자동으로 취급한다', () => {
    expect(resolveTargetLanguage(undefined, '보급 상자 스폰 규칙').language).toBe('영어');
    expect(resolveTargetLanguage('', 'Care package spawn rules').language).toBe('한국어');
  });

  it('명시 선택은 그대로 통과시킨다 (자동이 사용자 선택을 덮지 않는다)', () => {
    expect(resolveTargetLanguage('일본어', '보급 상자 스폰 규칙')).toEqual({
      language: '일본어',
      auto: false,
    });
    // 원문과 같은 언어를 골라도 여기서 바꾸지 않는다 — 차단은 호출부 가드의 몫
    expect(resolveTargetLanguage('한국어', '보급 상자 스폰 규칙')).toEqual({
      language: '한국어',
      auto: false,
    });
  });

  it('자동인데 KO/EN이 아니면 null — 호출부가 명시 선택을 요구한다', () => {
    expect(resolveTargetLanguage(AUTO_TARGET_LANGUAGE, 'このアップデート').language).toBeNull();
    expect(resolveTargetLanguage(AUTO_TARGET_LANGUAGE, '').language).toBeNull();
  });
});
