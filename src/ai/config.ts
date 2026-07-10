import { useAiConfigStore } from '@/stores/aiConfigStore';

/**
 * AI Provider 타입
 * - openai: OpenAI (GPT-5 시리즈)
 * - anthropic: Anthropic (Claude 시리즈)
 * - mock: 개발/테스트용 (내부적으로 OpenAI 사용)
 */
export type AiProvider = 'openai' | 'anthropic' | 'mock';

export type ReasoningEffort = 'medium' | 'high';

interface ModelPreset {
  /** 설정 저장/UI 선택에 사용하는 고유 ID */
  value: string;
  label: string;
  description: string;
  /** value와 실제 API model ID가 다를 때 명시 */
  apiModel?: string;
  reasoningEffort?: ReasoningEffort;
}

export const MODEL_PRESETS: Record<'anthropic' | 'openai', readonly ModelPreset[]> = {
  anthropic: [
    { value: 'claude-opus-4-8', label: 'Opus 4.8', description: '높은 정확도, 복잡한 작업에 적합' },
    { value: 'claude-sonnet-5', label: 'Sonnet 5', description: '성능/속도/비용 균형 (권장)' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', description: '빠른 응답, 낮은 비용' },
  ],
  openai: [
    {
      value: 'gpt-5.6-sol-high',
      label: 'GPT-5.6 Sol · High',
      description: '최고 성능, 높은 추론 강도',
      apiModel: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    },
    {
      value: 'gpt-5.6-luna-high',
      label: 'GPT-5.6 Luna · High',
      description: '비용 효율 모델, 높은 추론 강도',
      apiModel: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    },
    {
      value: 'gpt-5.6-luna-medium',
      label: 'GPT-5.6 Luna · Medium',
      description: '빠른 응답과 비용 균형',
      apiModel: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
    },
  ],
};

export interface AiConfig {
  provider: AiProvider;
  model: string;
  /**
   * 일부 최신 모델/엔드포인트는 temperature를 무시/제약할 수 있어 선택 사항으로 둡니다.
   * (값이 없으면 클라이언트에 temperature를 전달하지 않습니다.)
   */
  temperature?: number;
  /** OpenAI Responses/Chat Completions reasoning effort */
  reasoningEffort?: ReasoningEffort;
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

export function getAiConfig(options?: { useFor?: 'translation' | 'chat' | 'review' }): AiConfig {
  // 1. Store에서 설정 가져오기 (런타임 변경사항 반영)
  const store = useAiConfigStore.getState();

  // 2. 용도에 따른 모델 선택 (review는 번역 모델을 재사용)
  const useFor = options?.useFor ?? 'chat'; // 기본값은 chat (가장 빈번함)
  const rawModel = (useFor === 'translation' || useFor === 'review') ? store.translationModel : store.chatModel;

  // 3. 모델명에서 provider 자동 결정
  const provider: AiProvider = rawModel.startsWith('claude') ? 'anthropic' : 'openai';

  // 4. 해당 provider의 프리셋에서 모델 검증
  const presetKey = provider === 'anthropic' ? 'anthropic' : 'openai';
  const presets = MODEL_PRESETS[presetKey];
  const preset = presets.find((p) => p.value === rawModel) ?? presets[0]!;
  const model = preset.apiModel ?? preset.value;

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
    ...(preset.reasoningEffort ? { reasoningEffort: preset.reasoningEffort } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: 20,
  };
}
