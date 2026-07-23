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

function isDevRuntime(): boolean {
  return Boolean(import.meta.env.DEV);
}

/** 테스트 또는 Vite serve(dev/tauri:dev)에서만 .env* API 키 fallback 허용 */
function allowEnvApiKeyFallback(): boolean {
  return isTestRuntime() || isDevRuntime();
}

function getDevInjectedApiKey(kind: 'openai' | 'anthropic'): string | undefined {
  // vite.config.ts define — serve에서만 실제 값, production build는 ''
  const raw =
    kind === 'openai'
      ? (typeof __DEV_OPENAI_API_KEY__ !== 'undefined' ? __DEV_OPENAI_API_KEY__ : '')
      : (typeof __DEV_ANTHROPIC_API_KEY__ !== 'undefined' ? __DEV_ANTHROPIC_API_KEY__ : '');
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnvApiKeyFallback(kind: 'openai' | 'anthropic'): string | undefined {
  if (!allowEnvApiKeyFallback()) return undefined;
  // vitest: process.env / tauri:dev(serve): __DEV_*__ inject
  return (
    getProcessEnvString(kind === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY') ||
    getDevInjectedApiKey(kind)
  );
}

/**
 * 프리셋 ID(rawModel) → provider/실제 모델 ID/추론 강도 해석
 * getAiConfig와 resolveModelRunConfig가 공유하는 단일 소스입니다.
 */
export function resolveModelFromPreset(rawModel: string): {
  provider: 'openai' | 'anthropic';
  model: string;
  reasoningEffort?: ReasoningEffort;
} {
  const provider: 'openai' | 'anthropic' = rawModel.startsWith('claude') ? 'anthropic' : 'openai';
  const presets = MODEL_PRESETS[provider];
  const preset = presets.find((p) => p.value === rawModel) ?? presets[0]!;
  return {
    provider,
    model: preset.apiModel ?? preset.value,
    ...(preset.reasoningEffort ? { reasoningEffort: preset.reasoningEffort } : {}),
  };
}

export function getAiConfig(options?: { useFor?: 'translation' | 'chat' | 'review' }): AiConfig {
  // 1. Store에서 설정 가져오기 (런타임 변경사항 반영)
  const store = useAiConfigStore.getState();

  // 2. 용도에 따른 모델 선택 (review는 번역 모델을 재사용)
  const useFor = options?.useFor ?? 'chat'; // 기본값은 chat (가장 빈번함)
  const rawModel = (useFor === 'translation' || useFor === 'review') ? store.translationModel : store.chatModel;

  // 3~4. 모델명에서 provider/실제 모델/추론 강도 해석
  const { provider, model, reasoningEffort: presetReasoningEffort } = resolveModelFromPreset(rawModel);

  // 5. API Key 우선순위
  // - Store(설정/secure store) 우선
  // - 테스트·dev(serve): Store가 비어 있으면 .env/.env.local fallback
  // - production 빌드: Store만 사용 (번들에 env 키를 넣지 않음)
  const openaiApiKey = store.openaiApiKey || getEnvApiKeyFallback('openai');
  const anthropicApiKey = store.anthropicApiKey || getEnvApiKeyFallback('anthropic');

  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  // exactOptionalPropertyTypes 대응: undefined 값은 프로퍼티 자체를 생략
  return {
    provider,
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(presetReasoningEffort ? { reasoningEffort: presetReasoningEffort } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: 20,
  };
}

/**
 * 단일 요청의 불변 실행 설정 (ModelRunConfig)
 *
 * 요청 시작 시 한 번 캡처하여, 준비/스트리밍/도구 루프가 동일한 모델·설정을 사용하도록 보장합니다.
 * 이후 전역 aiConfigStore가 바뀌어도 진행 중 요청의 모델은 변하지 않습니다. (경쟁 조건 제거)
 *
 * NOTE: capability profile / 토큰 예산 필드는 Phase 3(장기 대화 context manager)에서 확장됩니다.
 */
export interface ModelRunConfig {
  /** 사용자가 선택한 프리셋 ID (세션 modelPreset 또는 전역 기본값) */
  requestedPreset: string;
  /** 실제 API 호출에 사용할 모델 ID */
  resolvedModel: string;
  provider: AiProvider;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  /**
   * @deprecated Phase 3에서 고정 N개 slice 경로는 토큰 예산 기반 context planner
   * (src/ai/chatContext/conversationContext.ts)로 대체됨. 하위호환을 위해 필드는 유지하되
   * 채팅 히스토리 절단에는 더 이상 사용되지 않는다.
   */
  maxRecentMessages: number;
}

/**
 * 요청 실행 설정을 한 번 캡처합니다.
 * @param options.preset 세션별 modelPreset. 없으면 전역 chat/translation 모델 사용.
 * @param options.useFor 기본 'chat'. translation/review는 전역 translationModel 사용.
 */
export function resolveModelRunConfig(options?: {
  preset?: string;
  useFor?: 'translation' | 'chat' | 'review';
}): ModelRunConfig {
  const store = useAiConfigStore.getState();
  const useFor = options?.useFor ?? 'chat';
  const globalRaw =
    useFor === 'translation' || useFor === 'review' ? store.translationModel : store.chatModel;
  const rawModel = options?.preset ?? globalRaw;

  const { provider, model, reasoningEffort } = resolveModelFromPreset(rawModel);

  const openaiApiKey = store.openaiApiKey || getEnvApiKeyFallback('openai');
  const anthropicApiKey = store.anthropicApiKey || getEnvApiKeyFallback('anthropic');
  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  return Object.freeze({
    requestedPreset: rawModel,
    resolvedModel: model,
    provider,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: 20,
  });
}
