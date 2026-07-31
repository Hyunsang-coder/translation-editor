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
 * - OpenAI: 2026-07-30 가격 개편 반영값(Luna -80%, Sol 동결). 캐시 read는 정가의 0.1배이며,
 *   캐시 write에 대한 별도 과금이 없어(자동 캐싱) `cacheWritePerMTok`은 두지 않는다 —
 *   LangChain도 OpenAI 응답에서 cache_creation을 채우지 않으므로 해당 항목은 항상 0이다.
 *   Sol Fast(`service_tier: "priority"`)는 Standard의 2배지만 이 앱은 쓰지 않아 표에 없다.
 *
 * 키는 `MODEL_BY_USE`가 돌려주는 **실제 API 모델 ID**다. 매핑에서 빠진 모델(Haiku 등)도
 * 과거 사용량 기록의 단가 조회에 필요하므로 남긴다.
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

  // ── OpenAI (2026-07-30 개편 반영) ────────────────────────────
  'gpt-5.6-sol': {
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5, // 5 × 0.1
  },
  'gpt-5.6-terra': {
    inputPerMTok: 2, // 개편 전 $2.50
    outputPerMTok: 12, // 개편 전 $15
    cacheReadPerMTok: 0.2, // 2 × 0.1
  },
  'gpt-5.6-luna': {
    inputPerMTok: 0.2, // 개편 전 $1
    outputPerMTok: 1.2, // 개편 전 $6
    cacheReadPerMTok: 0.02, // 0.2 × 0.1
  },
};

export interface UsageTokenCounts {
  /**
   * **캐시 read/write를 포함한 총 입력 토큰.** 장부에 들어오는 값이 그렇다
   * (`usageLedger.mergeUsageFromChunk` 참조) — 정가로 물릴 몫은 여기서 캐시분을 뺀 나머지다.
   */
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
 * `inputTokens`에는 캐시 read/write가 이미 포함되어 있으므로, 정가 구간은 그만큼 빼고 센다.
 * 빼지 않으면 캐시분을 정가로 한 번, 캐시 단가로 또 한 번 물어 이중 계상된다
 * (캐시가 잘 맞을수록 오차가 커진다). 음수는 0으로 막는다 — provider가 보고한 세부 합이
 * 총합을 넘는 경우에 총액이 줄어드는(과소추정) 쪽으로 새는 것을 막기 위해서다.
 *
 * 캐시 단가가 없으면 정가를 적용한다(과대추정). 그 경우 `cacheSavingsUsd`는 0이 된다.
 */
export function estimateCost(model: string, usage: UsageTokenCounts): EstimatedCost | null {
  const price = getModelPrice(model);
  if (!price) return null;

  const cacheReadRate = price.cacheReadPerMTok ?? price.inputPerMTok;
  const cacheWriteRate = price.cacheWritePerMTok ?? price.inputPerMTok;

  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cacheReadInputTokens - usage.cacheCreationInputTokens,
  );

  const inputUsd = (uncachedInputTokens / PER_MTOK) * price.inputPerMTok;
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
