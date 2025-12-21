export type AiProvider = 'openai' | 'anthropic' | 'mock';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  /**
   * 일부 최신 모델/엔드포인트는 temperature를 무시/제약할 수 있어 선택 사항으로 둡니다.
   * (값이 없으면 클라이언트에 temperature를 전달하지 않습니다.)
   */
  temperature?: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  maxRecentMessages: number;
}

function getEnvString(key: string): string | undefined {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function getEnvNumber(key: string, fallback: number): number {
  const raw = getEnvString(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getEnvOptionalNumber(key: string): number | undefined {
  const raw = getEnvString(key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function getAiConfig(): AiConfig {
  const providerRaw = (getEnvString('VITE_AI_PROVIDER') ?? 'mock').toLowerCase();
  const provider: AiProvider =
    providerRaw === 'openai' ? 'openai' : providerRaw === 'anthropic' ? 'anthropic' : 'mock';

  const model =
    getEnvString('VITE_AI_MODEL') ??
    (provider === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini');

  const openaiApiKey = getEnvString('VITE_OPENAI_API_KEY');
  const anthropicApiKey = getEnvString('VITE_ANTHROPIC_API_KEY');
  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  // exactOptionalPropertyTypes 대응: undefined 값은 프로퍼티 자체를 생략
  return {
    provider,
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: Math.max(4, Math.floor(getEnvNumber('VITE_AI_MAX_RECENT_MESSAGES', 12))),
  };
}


