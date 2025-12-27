import { useAiConfigStore } from '@/stores/aiConfigStore';

export type AiProvider = 'openai' | 'anthropic' | 'google' | 'mock';

export const MODEL_PRESETS = {
  openai: [
    { value: 'gpt-5.2', label: 'GPT-5.2', description: '코딩 및 에이전트 작업에 최적화된 산업 전반 최고의 모델' },
    { value: 'gpt-5-mini', label: 'GPT-5-mini', description: '명확한 작업을 위한 빠르고 비용 효율적인 GPT-5 버전' },
    { value: 'gpt-5-nano', label: 'GPT-5 nano', description: '가장 빠르고 비용 효율적인 GPT-5 버전' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: '균형 잡힌 고성능 모델' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: '매우 빠른 응답 속도' },
    { value: 'claude-4-5-sonnet', label: 'Claude 4.5 Sonnet', description: '차세대 고성능 모델' },
    { value: 'claude-4-5-haiku', label: 'Claude 4.5 Haiku', description: '차세대 초고속 모델' },
  ],
  google: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: '빠른 속도와 효율성을 갖춘 최신 Gemini 모델' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: '비용 효율적인 경량화 Gemini 모델' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: '복잡한 작업에 최적화된 고성능 Gemini 모델' },
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
  anthropicApiKey?: string;
  googleApiKey?: string;
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
  const provider = store.provider;
  
  // 2. 용도에 따른 모델 선택
  const useFor = options?.useFor ?? 'chat'; // 기본값은 chat (가장 빈번함)
  const rawModel = useFor === 'translation' ? store.translationModel : store.chatModel;
  const providerKey: Exclude<AiProvider, 'mock'> = provider === 'mock' ? 'openai' : provider;
  const presets = MODEL_PRESETS[providerKey];
  const model = presets.some((p) => p.value === rawModel) ? rawModel : presets[0].value;

  // 3. API Key 우선순위: Store의 사용자 입력 키 > 환경 변수
  const envOpenaiKey = getEnvString('VITE_OPENAI_API_KEY');
  const envAnthropicKey = getEnvString('VITE_ANTHROPIC_API_KEY');
  const envGoogleKey = getEnvString('VITE_GOOGLE_API_KEY');
  const openaiApiKey = store.openaiApiKey || envOpenaiKey;
  const anthropicApiKey = store.anthropicApiKey || envAnthropicKey;
  const googleApiKey = store.googleApiKey || envGoogleKey;

  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  // exactOptionalPropertyTypes 대응: undefined 값은 프로퍼티 자체를 생략
  return {
    provider,
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(googleApiKey ? { googleApiKey } : {}),
    maxRecentMessages: Math.max(4, Math.floor(getEnvNumber('VITE_AI_MAX_RECENT_MESSAGES', 12))),
    judgeModel:
      getEnvString('VITE_AI_JUDGE_MODEL') ??
      (provider === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-5-mini'),
  };
}
