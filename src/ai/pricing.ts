/**
 * 모델별 단가와 사용량 → 추정 비용 환산.
 *
 * **여기 값은 추정용이다.** 실제 청구는 provider 콘솔이 진실이며, 배치 할인·무료 크레딧·
 * 엔터프라이즈 계약가는 반영되지 않는다. UI는 반드시 "추정치"임을 표기해야 한다.
 *
 * 단가가 없는 모델은 `null`을 반환한다. 모르는 값을 0으로 두면 "공짜"로 보여
 * 틀린 숫자를 신뢰하게 만들기 때문이다. UI는 null을 "가격 미상"으로 표시할 것.
 */

/** 100만 토큰당 USD */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /**
   * 캐시에서 읽은 입력 토큰의 100만 토큰당 USD.
   * 모르면 생략한다 — 그 경우 계산기가 정가(inputPerMTok)를 적용해 **비용을 과대추정**한다.
   * 과소추정보다 과대추정이 안전한 실패 방향이다.
   */
  cacheReadPerMTok?: number;
  /**
   * 캐시에 새로 기록한 입력 토큰의 100만 토큰당 USD.
   * 생략하면 정가를 적용한다.
   */
  cacheWritePerMTok?: number;
}

/**
 * 단가표 (2026-07 기준).
 *
 * - Anthropic: 공식 문서(platform.claude.com/docs/en/about-claude/models/overview) 확인값.
 *   캐시 read는 정가의 0.1배, write(5m TTL)는 1.25배. 이 앱은 5m TTL만 쓴다.
 * - OpenAI: 공식 가격 페이지를 직접 확인하지 못해 서드파티 집계(복수 출처 일치)를 옮겼다.
 *   캐시 할인 배수는 확인하지 못해 **생략**했다 → 캐시분도 정가로 계산되어 과대추정된다.
 *   정확한 비용이 필요하면 OpenAI 콘솔 단가로 이 표를 갱신할 것.
 *
 * 키는 `resolveModelFromPreset`이 돌려주는 **실제 API 모델 ID**다(프리셋 ID 아님).
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // ── Anthropic (공식 문서 확인값) ──────────────────────────────
  'claude-opus-5': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5, // 5 × 0.1
    cacheWritePerMTok: 6.25, // 5 × 1.25
  },
  'claude-sonnet-5': {
    // 2026-08-31까지 $2/$10 도입가가 적용되지만, 만료 후 과거 기록까지 바뀌면
    // 혼란스러우므로 정가를 쓴다(도입가 구간은 실제 청구가 이보다 낮다).
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  'claude-haiku-4-5': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
  },

  // ── OpenAI (서드파티 집계, 캐시 배수 미확인) ──────────────────
  'gpt-5.6-sol': { inputPerMTok: 5, outputPerMTok: 30 },
  'gpt-5.6-luna': { inputPerMTok: 1, outputPerMTok: 6 },
};

export interface UsageTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface EstimatedCost {
  /** 총 추정 비용 (USD) */
  totalUsd: number;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  /**
   * 캐시가 없었다면 추가로 냈을 금액 (USD).
   * 캐시로 읽은 토큰을 정가로 냈을 때와의 차액이다.
   */
  cacheSavingsUsd: number;
}

const PER_MTOK = 1_000_000;

export function getModelPrice(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}

/**
 * 사용량을 추정 비용으로 환산한다. 단가를 모르는 모델은 `null`.
 *
 * 캐시 단가가 없으면 정가를 적용한다(과대추정). 그 경우 `cacheSavingsUsd`는 0이 된다.
 */
export function estimateCost(model: string, usage: UsageTokenCounts): EstimatedCost | null {
  const price = getModelPrice(model);
  if (!price) return null;

  const cacheReadRate = price.cacheReadPerMTok ?? price.inputPerMTok;
  const cacheWriteRate = price.cacheWritePerMTok ?? price.inputPerMTok;

  const inputUsd = (usage.inputTokens / PER_MTOK) * price.inputPerMTok;
  const outputUsd = (usage.outputTokens / PER_MTOK) * price.outputPerMTok;
  const cacheReadUsd = (usage.cacheReadInputTokens / PER_MTOK) * cacheReadRate;
  const cacheWriteUsd = (usage.cacheCreationInputTokens / PER_MTOK) * cacheWriteRate;

  // 캐시로 읽은 토큰을 정가로 냈을 경우와의 차액.
  const cacheReadAtFullPrice = (usage.cacheReadInputTokens / PER_MTOK) * price.inputPerMTok;

  return {
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd,
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    cacheSavingsUsd: Math.max(0, cacheReadAtFullPrice - cacheReadUsd),
  };
}

/** 소액도 0으로 보이지 않도록 자릿수를 조절해 표시한다. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
