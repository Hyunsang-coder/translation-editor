import { useAiConfigStore } from '@/stores/aiConfigStore';

/**
 * AI Provider 타입
 * - openai: 유일한 프로덕션 Provider
 * - mock: 개발/테스트용 (내부적으로 OpenAI 사용)
 */
export type AiProvider = 'openai' | 'mock';

export const MODEL_PRESETS = {
  openai: [
    { value: 'gpt-5.2', label: 'GPT-5.2', description: '가장 빠르고 강력한 모델' },
    { value: 'gpt-5-mini', label: 'GPT-5-mini', description: '준수한 성능과 가성비' },
    { value: 'gpt-5-nano', label: 'GPT-5 nano', description: '가장 경제적인 모델' },
  ],
} as const;

export interface AiConfig {
  provider: AiProvider;
  model: string;
  /**
   * 일부 최신 모델/엔드포인트는 temperature를 무시/제약할 수 있어 선택 사항으로 둡니다.
   * (값이 없으면 클라이언트에 temperature를 전달하지 않습니다.)
   */
  temperature?: number;
  openaiApiKey?: string;
  braveApiKey?: string;
  maxRecentMessages: number;
  judgeModel: string;
}

function getEnvString(key: string): string | undefined {
  // Vite exposes env via import.meta.env (only keys allowed by envPrefix)
  const v = (import.meta as any).env?.[key] as string | undefined;
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

export function getAiConfig(options?: { useFor?: 'translation' | 'chat' }): AiConfig {
  // 1. Store에서 설정 가져오기 (런타임 변경사항 반영)
  const store = useAiConfigStore.getState();
  // OpenAI 전용으로 단순화 (mock은 개발용, 내부적으로 openai 사용)
  const provider: AiProvider = store.provider === 'mock' ? 'mock' : 'openai';

  // 2. 용도에 따른 모델 선택
  const useFor = options?.useFor ?? 'chat'; // 기본값은 chat (가장 빈번함)
  const rawModel = useFor === 'translation' ? store.translationModel : store.chatModel;
  const presets = MODEL_PRESETS.openai;
  const model = presets.some((p) => p.value === rawModel) ? rawModel : presets[0].value;

  // 3. API Key: Store의 사용자 입력 키만 사용 (환경 변수 지원 중단)
  const openaiApiKey = store.openaiApiKey;
  const braveApiKey = store.braveApiKey;

  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  // exactOptionalPropertyTypes 대응: undefined 값은 프로퍼티 자체를 생략
  return {
    provider,
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(braveApiKey ? { braveApiKey } : {}),
    maxRecentMessages: Math.max(4, Math.floor(getEnvNumber('VITE_AI_MAX_RECENT_MESSAGES', 20))),
    judgeModel: getEnvString('VITE_AI_JUDGE_MODEL') ?? 'gpt-5-mini',
  };
}
