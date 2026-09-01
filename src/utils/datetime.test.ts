import { describe, it, expect } from 'vitest';
import { formatTimeOfDay } from './datetime';

// 2026-09-01 17:18:30 (로컬 시각) — TZ에 의존하지 않도록 컴포넌트로 만든다
const AFTERNOON = new Date(2026, 8, 1, 17, 18, 30);

describe('formatTimeOfDay', () => {
  it('로케일의 시간 표기 관례를 따른다 (12/24시간)', () => {
    expect(formatTimeOfDay(AFTERNOON, 'ko-KR')).toBe('오후 5:18');
    expect(formatTimeOfDay(AFTERNOON, 'en-US')).toBe('5:18 PM');
    expect(formatTimeOfDay(AFTERNOON, 'en-GB')).toBe('17:18');
  });

  it('시(hour)에 0을 덧대지 않는다 — 오후 05:18이 아니라 오후 5:18', () => {
    const morning = new Date(2026, 8, 1, 5, 7, 0);
    expect(formatTimeOfDay(morning, 'ko-KR')).toBe('오전 5:07');
    expect(formatTimeOfDay(morning, 'en-GB')).toBe('05:07');
  });

  it('초를 표시하지 않는다', () => {
    for (const locale of ['ko-KR', 'en-US', 'en-GB'] as const) {
      expect(formatTimeOfDay(AFTERNOON, locale)).not.toContain('30');
    }
  });

  it('타임스탬프(number)와 Date를 같게 다룬다', () => {
    expect(formatTimeOfDay(AFTERNOON.getTime(), 'ko-KR')).toBe(formatTimeOfDay(AFTERNOON, 'ko-KR'));
  });

  it('로케일을 생략하면 시스템 설정을 따른다 (앱 언어를 하드코딩하지 않는다)', () => {
    const expected = AFTERNOON.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(formatTimeOfDay(AFTERNOON)).toBe(expected);
  });

  it('호출부가 달라도 같은 시각은 같은 문자열이 된다', () => {
    // 회귀 방지: StatusStrip은 24시간 0패딩, historyStore는 오후 05:18로 서로 달랐다
    const fromNumber = formatTimeOfDay(AFTERNOON.getTime());
    const fromDate = formatTimeOfDay(new Date(AFTERNOON.getTime()));
    expect(fromNumber).toBe(fromDate);
  });
});

describe('formatTimeOfDay — 지역 설정의 24시간 토글', () => {
  it('같은 언어라도 24시간 표기면 24시간으로 찍고 시에 0을 덧댄다', () => {
    const morning = new Date(2026, 8, 1, 5, 7, 0);
    expect(formatTimeOfDay(morning, 'ko-KR-u-hc-h23')).toBe('05:07');
    expect(formatTimeOfDay(morning, 'ko-KR')).toBe('오전 5:07');
  });
});
