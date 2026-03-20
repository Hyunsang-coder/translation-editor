import { useAiConfigStore } from '@/stores/aiConfigStore';

/**
 * AI Provider 타입
 * - openai: OpenAI (GPT-5 시리즈)
 * - anthropic: Anthropic (Claude 시리즈)
 * - mock: 개발/테스트용 (내부적으로 OpenAI 사용)
 */
export type AiProvider = 'openai' | 'anthropic' | 'mock';

export const MODEL_PRESETS = {
  anthropic: [
    { value: 'claude-opus-4-6', label: 'Opus 4.6', description: '높은 정확도, 복잡한 작업에 적합' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: '성능/속도/비용 균형 (권장)' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', description: '빠른 응답, 낮은 비용' },
  ],
  openai: [
    { value: 'gpt-5.4', label: 'GPT-5.4', description: '최신 모델, 최고 성능' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: '빠른 응답, 낮은 비용' },
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
  maxRecentMessages: number;
}

function getEnvString(key: string): string | undefined {
  // Vite exposes env via import.meta.env (only keys allowed by envPrefix)
  const env = import.meta.env as Record<string, unknown>;
  const v = env[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function getEnvOptionalNumber(key: string): number | undefined {
  const raw = getEnvString(key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function getProcessEnvString(key: string): string | undefined {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function isTestRuntime(): boolean {
  return getEnvString('MODE') === 'test' || process.env.VITEST === 'true';
}

export function getAiConfig(options?: { useFor?: 'translation' | 'chat' }): AiConfig {
  // 1. Store에서 설정 가져오기 (런타임 변경사항 반영)
  const store = useAiConfigStore.getState();

  // 2. 용도에 따른 모델 선택
  const useFor = options?.useFor ?? 'chat'; // 기본값은 chat (가장 빈번함)
  const rawModel = useFor === 'translation' ? store.translationModel : store.chatModel;

  // 3. 모델명에서 provider 자동 결정
  const provider: AiProvider = rawModel.startsWith('claude') ? 'anthropic' : 'openai';

  // 4. 해당 provider의 프리셋에서 모델 검증
  const presetKey = provider === 'anthropic' ? 'anthropic' : 'openai';
  const presets = MODEL_PRESETS[presetKey];
  const model = presets.some((p) => p.value === rawModel) ? rawModel : presets[0].value;

  // 5. API Key 우선순위
  // - 런타임 앱: Store 값만 사용
  // - 테스트(vitest): Store 값이 없으면 process.env(.env.local 주입값)로 fallback
  const openaiApiKey = store.openaiApiKey || (isTestRuntime() ? getProcessEnvString('OPENAI_API_KEY') : undefined);
  const anthropicApiKey = store.anthropicApiKey || (isTestRuntime() ? getProcessEnvString('ANTHROPIC_API_KEY') : undefined);

  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  // exactOptionalPropertyTypes 대응: undefined 값은 프로퍼티 자체를 생략
  return {
    provider,
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: 20,
  };
}
