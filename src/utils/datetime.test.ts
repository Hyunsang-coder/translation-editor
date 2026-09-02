import { describe, it, expect } from 'vitest';
import { formatTimeOfDay } from './datetime';

// 2026-09-01 17:18:30 (로컬 시각) — TZ에 의존하지 않도록 컴포넌트로 만든다
const AFTERNOON = new Date(2026, 8, 1, 17, 18, 30);
const MORNING = new Date(2026, 8, 1, 5, 7, 0);

/**
 * 실행 환경의 ICU에 영어 말고 다른 로케일 데이터가 있는지.
 * CI 러너에는 없을 수 있어(한국어 오전/오후 대신 AM/PM이 나온다) 표시명에
 * 기대는 단언은 건너뛴다 — ICU 데이터는 이 유틸의 계약이 아니다.
 */
const HAS_LOCALE_DATA = AFTERNOON
  .toLocaleTimeString('ko-KR', { timeStyle: 'short' })
  .includes('오후');

describe('formatTimeOfDay', () => {
  it('로케일의 짧은 시각 형식을 그대로 따른다 (자체 형식을 만들지 않는다)', () => {
    // 계약: timeStyle:'short'. hour:'numeric'이면 24시간 로케일에서 0패딩이 빠지고
    // hour:'2-digit'이면 12시간 로케일에서 "오후 05:18"이 된다 — 둘 다 안 된다.
    for (const locale of ['ko-KR', 'en-US', 'en-GB', 'de-DE'] as const) {
      for (const date of [AFTERNOON, MORNING]) {
        expect(formatTimeOfDay(date, locale))
          .toBe(date.toLocaleTimeString(locale, { timeStyle: 'short' }));
      }
    }
  });

  it('초를 표시하지 않는다', () => {
    for (const locale of ['ko-KR', 'en-US', 'en-GB'] as const) {
      expect(formatTimeOfDay(AFTERNOON, locale)).not.toContain('30');
    }
  });

  it('타임스탬프(number)와 Date를 같게 다룬다', () => {
    expect(formatTimeOfDay(AFTERNOON.getTime())).toBe(formatTimeOfDay(AFTERNOON));
  });

  it('로케일을 생략하면 시스템 설정을 따른다 (앱 언어를 하드코딩하지 않는다)', () => {
    expect(formatTimeOfDay(AFTERNOON))
      .toBe(AFTERNOON.toLocaleTimeString([], { timeStyle: 'short' }));
  });

  it('호출부가 달라도 같은 시각은 같은 문자열이 된다', () => {
    // 회귀 방지: StatusStrip은 24시간 0패딩, historyStore는 "오후 05:18"로 서로 달랐다.
    expect(formatTimeOfDay(AFTERNOON.getTime())).toBe(formatTimeOfDay(new Date(AFTERNOON.getTime())));
  });

  it.skipIf(!HAS_LOCALE_DATA)('12시간 로케일은 시에 0을 덧대지 않는다', () => {
    expect(formatTimeOfDay(AFTERNOON, 'ko-KR')).toBe('오후 5:18');
    expect(formatTimeOfDay(MORNING, 'ko-KR')).toBe('오전 5:07');
  });

  it.skipIf(!HAS_LOCALE_DATA)('24시간 로케일은 시에 0을 덧댄다', () => {
    expect(formatTimeOfDay(AFTERNOON, 'de-DE')).toBe('17:18');
    expect(formatTimeOfDay(MORNING, 'de-DE')).toBe('05:07');
  });

  it.skipIf(!HAS_LOCALE_DATA)('같은 언어라도 24시간 표기 설정이면 24시간으로 찍는다', () => {
    expect(formatTimeOfDay(MORNING, 'ko-KR-u-hc-h23')).toBe('05:07');
    expect(formatTimeOfDay(MORNING, 'ko-KR')).toBe('오전 5:07');
  });
});
