import { describe, it, expect } from 'vitest';
import { summarizeUsageRows, type UsageDailyRow } from './UsageSection';

function row(partial: Partial<UsageDailyRow> & { day: string; model: string }): UsageDailyRow {
  return {
    feature: 'chat',
    provider: 'anthropic',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    modelCalls: 1,
    requestCount: 1,
    ...partial,
  };
}

describe('summarizeUsageRows', () => {
  it('일자별로 접고 최신 날짜를 먼저 둔다', () => {
    const summaries = summarizeUsageRows([
      row({ day: '2026-07-01', model: 'claude-opus-5', inputTokens: 1000 }),
      row({ day: '2026-07-03', model: 'claude-opus-5', inputTokens: 2000 }),
      row({ day: '2026-07-01', model: 'claude-opus-5', feature: 'translate', outputTokens: 500 }),
    ]);

    expect(summaries.map((s) => s.day)).toEqual(['2026-07-03', '2026-07-01']);
    expect(summaries[1]!.rows).toHaveLength(2);
    expect(summaries[1]!.totalTokens).toBe(1500);
  });

  it('캐시 read/write도 총 토큰에 포함한다', () => {
    const [summary] = summarizeUsageRows([
      row({
        day: '2026-07-01',
        model: 'claude-opus-5',
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 400,
      }),
    ]);

    expect(summary!.totalTokens).toBe(1000);
  });

  it('비용과 캐시 절감액을 단가로 환산한다', () => {
    const [summary] = summarizeUsageRows([
      row({ day: '2026-07-01', model: 'claude-opus-5', cacheReadInputTokens: 1_000_000 }),
    ]);

    // $5 정가 대신 $0.5 → 비용 $0.5, 절감 $4.5
    expect(summary!.costUsd).toBeCloseTo(0.5, 6);
    expect(summary!.savingsUsd).toBeCloseTo(4.5, 6);
    expect(summary!.hasUnpricedModel).toBe(false);
  });

  it('단가 미등록 모델은 비용에서 빠지고 플래그로 알린다', () => {
    const [summary] = summarizeUsageRows([
      row({ day: '2026-07-01', model: 'unknown-model', inputTokens: 1_000_000 }),
      row({ day: '2026-07-01', model: 'claude-opus-5', inputTokens: 1_000_000 }),
    ]);

    // 모르는 단가를 0으로 넣어 "공짜"로 보이게 하지 않고, 합계에서 제외하고 표시로 알린다.
    expect(summary!.costUsd).toBeCloseTo(5, 6);
    expect(summary!.hasUnpricedModel).toBe(true);
    // 토큰 자체는 모르는 모델도 그대로 집계한다.
    expect(summary!.totalTokens).toBe(2_000_000);
  });
});
