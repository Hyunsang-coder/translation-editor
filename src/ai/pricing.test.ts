import { describe, it, expect } from 'vitest';
import { MODEL_PRICES, estimateCost, formatUsd, getModelPrice } from './pricing';
import { MODEL_BY_USE, MODEL_CHOICES } from './config';

describe('estimateCost', () => {
  it('입력/출력/캐시를 각각의 단가로 환산한다', () => {
    const cost = estimateCost('claude-opus-5', {
      // 총 입력 3M = 정가 1M + 캐시 read 1M + 캐시 write 1M
      inputTokens: 3_000_000,
      outputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
    })!;

    expect(cost.inputUsd).toBeCloseTo(5, 6);
    expect(cost.outputUsd).toBeCloseTo(25, 6);
    expect(cost.cacheReadUsd).toBeCloseTo(0.5, 6); // 정가의 0.1배
    expect(cost.cacheWriteUsd).toBeCloseTo(6.25, 6); // 정가의 1.25배
    expect(cost.totalUsd).toBeCloseTo(36.75, 6);
  });

  it('캐시분을 정가 입력에서 빼고 센다(이중 계상 금지)', () => {
    // provider가 보고하는 input_tokens는 캐시 read/write를 포함한 총합이다.
    // 전량이 캐시 히트면 정가로 물릴 입력은 0이어야 한다.
    const cost = estimateCost('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
    })!;

    expect(cost.inputUsd).toBe(0);
    expect(cost.totalUsd).toBeCloseTo(0.5, 6);
  });

  it('세부 합이 총 입력을 넘어도 정가 구간이 음수로 새지 않는다', () => {
    const cost = estimateCost('claude-opus-5', {
      inputTokens: 100,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
    })!;

    expect(cost.inputUsd).toBe(0);
  });

  it('캐시 절감액은 정가로 냈을 때와의 차액이다', () => {
    const cost = estimateCost('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
    })!;

    // 정가 $5 대신 $0.5를 냈으므로 $4.5 절감.
    expect(cost.cacheSavingsUsd).toBeCloseTo(4.5, 6);
  });

  it('OpenAI 2026-07-30 개편 단가를 쓴다', () => {
    const cost = estimateCost('gpt-5.6-luna', {
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
    })!;

    expect(cost.inputUsd).toBeCloseTo(0.2, 6); // 정가 1M × $0.20
    expect(cost.outputUsd).toBeCloseTo(1.2, 6);
    expect(cost.cacheReadUsd).toBeCloseTo(0.02, 6); // 정가의 0.1배
    // OpenAI는 캐시 write 과금이 없고 provider도 cache_creation을 보고하지 않는다.
    expect(cost.cacheWriteUsd).toBe(0);
    expect(cost.totalUsd).toBeCloseTo(1.42, 6);
  });

  it('단가를 모르는 모델은 null을 반환한다(0으로 처리하지 않는다)', () => {
    expect(getModelPrice('some-unreleased-model')).toBeNull();
    expect(
      estimateCost('some-unreleased-model', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
    ).toBeNull();
  });
});

describe('가격표 커버리지', () => {
  it('앱이 실제로 호출하는 모든 모델에 단가가 있다', () => {
    const missing: string[] = [];
    for (const [provider, byUse] of Object.entries(MODEL_BY_USE)) {
      for (const [useFor, spec] of Object.entries(byUse)) {
        if (!MODEL_PRICES[spec.model]) missing.push(`${provider}.${useFor} → ${spec.model}`);
      }
    }
    // MODEL_BY_USE에 새 모델을 넣고 단가를 빠뜨리면 여기서 잡힌다.
    expect(missing).toEqual([]);
  });

  it('사용자가 고를 수 있는 모든 모델에 단가가 있다', () => {
    // 단가가 없으면 사용량 화면이 "가격 미상"으로 빠져 비교 자체가 불가능해진다 —
    // 모델을 직접 고르게 하는 기능(ADR-0017)의 목적이 비용·품질 비교이므로 필수 조건이다.
    const missing: string[] = [];
    for (const [provider, models] of Object.entries(MODEL_CHOICES)) {
      for (const model of models) {
        if (!MODEL_PRICES[model]) missing.push(`${provider} → ${model}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('선택 목록은 그 provider의 기본 모델을 모두 포함한다', () => {
    // 기본값이 목록에 없으면 UI에서 "기본으로 되돌리기"를 고를 수 없다.
    const missing: string[] = [];
    for (const [provider, byUse] of Object.entries(MODEL_BY_USE)) {
      const choices = MODEL_CHOICES[provider as keyof typeof MODEL_CHOICES];
      for (const [useFor, spec] of Object.entries(byUse)) {
        if (!choices.includes(spec.model)) missing.push(`${provider}.${useFor} → ${spec.model}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('formatUsd', () => {
  it('소액도 0으로 보이지 않게 표시한다', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0003)).toBe('$0.0003');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
