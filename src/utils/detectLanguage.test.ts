/**
 * detectLanguage.ts 자동 방향 결정 단위 테스트
 *
 * 수동 타겟 언어 선택이 원문과 같은 언어로 남아 번역이 자기복사가 되던 문제를 막는 층이라,
 * 실패 모드(국문 원문 + 타겟 한국어)와 오탐 위험(영어 용어 범벅 국문, 일본어·중국어)을 함께 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
  AUTO_LANGUAGE,
  checkDirection,
  detectDominantLangCode,
  detectSourceLangCode,
  isSameLanguage,
  normalizeLang,
  resolveDirection,
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
    // 보수 판정(한글 30% 임계)으로는 답이 안 나오는 구간
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

describe('detectDominantLangCode', () => {
  it('문서를 지배하는 문자 체계를 고른다', () => {
    expect(detectDominantLangCode('이번 업데이트에서 보급 상자 스폰 규칙을 변경합니다.')).toBe('ko');
    expect(detectDominantLangCode('This update changes the care package spawn rules.')).toBe('en');
    expect(detectDominantLangCode('このアップデートで補給箱の仕様を変更します。')).toBe('ja');
    expect(detectDominantLangCode('本次更新调整了补给箱的生成规则。')).toBe('zh');
  });

  it('한국어 용어가 조금 섞인 영문 문서는 en — 방향 판정기와 답이 갈리고, 그게 의도다', () => {
    const text =
      'The care package spawn table was rebalanced this patch. ' +
      'Glossary: care package = 보급 상자, blue zone = 자기장, scope = 조준경. ' +
      'Weapon damage falloff was adjusted for all assault rifles.';
    expect(detectDominantLangCode(text)).toBe('en');
    // 같은 문서를 방향 판정기는 ko로 본다 (한글 5% 임계). 차단 가드에 쓰면 안 되는 이유.
    expect(detectSourceLangCode(text)).toBe('ko');
  });

  it('판단 재료가 없으면 null', () => {
    expect(detectDominantLangCode('')).toBeNull();
    expect(detectDominantLangCode('123 456 / 789')).toBeNull();
  });
});

describe('resolveDirection', () => {
  it('둘 다 자동이면 원문을 감지하고 타겟은 그 반대로 푼다', () => {
    expect(resolveDirection({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, '보급 상자 스폰 규칙')).toEqual({
      source: { language: '한국어', auto: true },
      target: { language: '영어', auto: true },
    });
    expect(resolveDirection({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, 'Care package spawn rules')).toEqual({
      source: { language: '영어', auto: true },
      target: { language: '한국어', auto: true },
    });
  });

  it('미설정(빈 값·null·undefined)도 자동으로 취급한다', () => {
    expect(resolveDirection(undefined, '보급 상자 스폰 규칙').target.language).toBe('영어');
    expect(resolveDirection(null, 'Care package spawn rules').target.language).toBe('한국어');
    expect(resolveDirection({ source: '', target: '' }, '보급 상자 스폰 규칙').target.language).toBe('영어');
  });

  it('명시 선택은 그대로 통과시킨다 (자동이 사용자 선택을 덮지 않는다)', () => {
    const d = resolveDirection({ source: AUTO_LANGUAGE, target: '일본어' }, '보급 상자 스폰 규칙');
    expect(d.target).toEqual({ language: '일본어', auto: false });
    // 원문과 같은 언어를 골라도 여기서 바꾸지 않는다 — 차단은 checkDirection의 몫
    expect(resolveDirection({ source: AUTO_LANGUAGE, target: '한국어' }, '보급 상자 스폰 규칙').target).toEqual({
      language: '한국어',
      auto: false,
    });
  });

  it('명시 원문이 자동 타겟의 근거가 된다 — 텍스트를 다시 감지하지 않는다', () => {
    // 문서는 국문이지만 원문을 '영어'로 명시했다면 타겟은 그 반대인 '한국어'다.
    const d = resolveDirection({ source: '영어', target: AUTO_LANGUAGE }, '보급 상자 스폰 규칙');
    expect(d.source).toEqual({ language: '영어', auto: false });
    expect(d.target).toEqual({ language: '한국어', auto: true });
  });

  it('자동인데 원문이 KO/EN이 아니면 타겟은 null — 호출부가 명시 선택을 요구한다', () => {
    const ja = resolveDirection({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, 'このアップデートで補給箱の仕様を変更します。');
    // 표시·프롬프트용 원문 라벨은 보수 판정으로 채우되, 방향은 뒤집지 않는다
    expect(ja.source.language).toBe('일본어');
    expect(ja.target.language).toBeNull();

    expect(resolveDirection({ source: '일본어', target: AUTO_LANGUAGE }, '아무 텍스트').target.language).toBeNull();
    expect(resolveDirection({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, '').target.language).toBeNull();
  });
});

describe('checkDirection', () => {
  const check = (stored: Parameters<typeof resolveDirection>[0], text: string) =>
    checkDirection(resolveDirection(stored, text), text);

  it('정상 방향은 통과', () => {
    expect(check({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, '보급 상자 스폰 규칙을 변경합니다')).toBeNull();
    expect(check({ source: '한국어', target: '영어' }, '보급 상자 스폰 규칙을 변경합니다')).toBeNull();
  });

  it('타겟을 못 정하면 target-undecided', () => {
    expect(check({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, 'このアップデート')).toBe('target-undecided');
  });

  it('원문과 타겟이 같은 언어면 same-language — 복사본에 굳은 스테일 타겟이 여기서 잡힌다', () => {
    expect(check({ source: AUTO_LANGUAGE, target: '한국어' }, '보급 상자 스폰 규칙을 변경합니다')).toBe('same-language');
  });

  it('명시 원문이 문서와 어긋나면 source-mismatch', () => {
    expect(check({ source: '영어', target: AUTO_LANGUAGE }, '보급 상자 스폰 규칙을 변경합니다')).toBe('source-mismatch');
  });

  it('한국어 용어가 섞인 영문 원문 + 명시 타겟 한국어를 막지 않는다 (보수 판정을 쓰는 이유)', () => {
    const text =
      'The care package spawn table was rebalanced this patch. ' +
      'Glossary: care package = 보급 상자, blue zone = 자기장, scope = 조준경. ' +
      'Weapon damage falloff was adjusted for all assault rifles.';
    expect(check({ source: AUTO_LANGUAGE, target: '한국어' }, text)).toBeNull();
  });

  it('보수 판정이 표현할 수 없는 언어(스페인어)를 명시하면 대조하지 않는다', () => {
    expect(check({ source: '스페인어', target: '한국어' }, 'Ajustamos las reglas de generacion')).toBeNull();
  });
});
