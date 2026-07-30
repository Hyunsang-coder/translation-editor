import { describe, it, expect } from 'vitest';
import { MODEL_PRICES, estimateCost, formatUsd, getModelPrice } from './pricing';
import { MODEL_BY_USE } from './config';

describe('estimateCost', () => {
  it('입력/출력/캐시를 각각의 단가로 환산한다', () => {
    const cost = estimateCost('claude-opus-5', {
      inputTokens: 1_000_000,
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

  it('캐시 절감액은 정가로 냈을 때와의 차액이다', () => {
    const cost = estimateCost('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
    })!;

    // 정가 $5 대신 $0.5를 냈으므로 $4.5 절감.
    expect(cost.cacheSavingsUsd).toBeCloseTo(4.5, 6);
  });

  it('캐시 단가를 모르는 모델은 정가를 적용해 과대추정한다(과소추정 금지)', () => {
    const cost = estimateCost('gpt-5.6-luna', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
    })!;

    // 캐시 할인 배수를 모르므로 정가($1)로 계산된다.
    expect(cost.cacheReadUsd).toBeCloseTo(1, 6);
    // 할인을 모르면 절감액도 주장하지 않는다.
    expect(cost.cacheSavingsUsd).toBe(0);
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
});

describe('formatUsd', () => {
  it('소액도 0으로 보이지 않게 표시한다', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0003)).toBe('$0.0003');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
