import { useAiConfigStore } from '@/stores/aiConfigStore';

/**
 * AI Provider 타입
 * - openai: OpenAI (GPT-5 시리즈)
 * - anthropic: Anthropic (Claude 시리즈)
 * - mock: 개발/테스트용 (내부적으로 OpenAI 사용)
 */
export type AiProvider = 'openai' | 'anthropic' | 'mock';

export type ReasoningEffort = 'medium' | 'high';

/** 사용자가 고르는 유일한 값. 모델·effort는 용도별로 앱이 고정한다 (ADR-0012). */
export type SelectableProvider = 'anthropic' | 'openai';

/**
 * 모델 해석의 용도 축.
 * - `translation`: 전체 번역 + 선택 재번역
 * - `polish`: 폴리싱 (번역과 같은 모델이지만 축을 분리해 함께 움직이지 않게 한다)
 * - `summary`: 대화 요약(내부, 사용자 비노출)
 */
export type ModelUseFor = 'translation' | 'chat' | 'review' | 'polish' | 'summary';

export interface ModelSpec {
  /** 실제 API 모델 ID */
  model: string;
  effort: ReasoningEffort;
}

/**
 * provider × 용도 → 모델·effort 고정 매핑 (ADR-0012).
 *
 * 프리셋 6개를 사용자가 고르던 방식을 폐기하고 여기로 대체했다. 번역·검수·폴리싱이
 * 설정 하나(`translationModel`)를 공유하던 탓에, 검수용으로 Opus로 바꾼 뒤 되돌리지
 * 않으면 폴리싱까지 Opus로 돌던 문제를 구조적으로 없앤다.
 *
 * effort는 전부 high로 고정한다(요약만 medium). Anthropic 기본값이 이미 high지만
 * 기본값이 바뀌어도 흔들리지 않도록 명시적으로 전송한다.
 */
export const MODEL_BY_USE: Readonly<
  Record<SelectableProvider, Readonly<Record<ModelUseFor, ModelSpec>>>
> = {
  anthropic: {
    translation: { model: 'claude-sonnet-5', effort: 'high' },
    review: { model: 'claude-opus-5', effort: 'high' },
    polish: { model: 'claude-sonnet-5', effort: 'high' },
    chat: { model: 'claude-sonnet-5', effort: 'high' },
    summary: { model: 'claude-sonnet-5', effort: 'medium' },
  },
  openai: {
    translation: { model: 'gpt-5.6-luna', effort: 'high' },
    review: { model: 'gpt-5.6-sol', effort: 'high' },
    polish: { model: 'gpt-5.6-luna', effort: 'high' },
    chat: { model: 'gpt-5.6-luna', effort: 'high' },
    summary: { model: 'gpt-5.6-luna', effort: 'medium' },
  },
};

export const PROVIDER_LABELS: Readonly<Record<SelectableProvider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export function resolveModelForUse(
  provider: SelectableProvider,
  useFor: ModelUseFor,
): ModelSpec {
  return MODEL_BY_USE[provider][useFor];
}

/**
 * 저장된 값(현재 provider 또는 v13 이전 프리셋 ID)을 provider로 정규화한다.
 *
 * 세션 pin(`chat_sessions.model_preset`)과 과거 메시지의 `requestedModelPreset`에는
 * `claude-sonnet-5` 같은 프리셋 ID가 남아 있다. 그대로 매핑 키로 쓰면 undefined를
 * 인덱싱하게 되므로 읽는 지점에서 반드시 통과시킨다.
 */
export function normalizeProvider(value: string | undefined | null): SelectableProvider | null {
  if (!value) return null;
  if (value === 'anthropic' || value === 'openai') return value;
  return value.startsWith('claude') ? 'anthropic' : 'openai';
}

export interface AiConfig {
  provider: AiProvider;
  model: string;
  /**
   * 일부 최신 모델/엔드포인트는 temperature를 무시/제약할 수 있어 선택 사항으로 둡니다.
   * (값이 없으면 클라이언트에 temperature를 전달하지 않습니다.)
   */
  temperature?: number;
  /** Anthropic `output_config.effort` / OpenAI `reasoning_effort`로 전달할 추론 강도 */
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

export function getAiConfig(options?: { useFor?: ModelUseFor }): AiConfig {
  // 1. Store에서 설정 가져오기 (런타임 변경사항 반영)
  const store = useAiConfigStore.getState();

  // 2. provider × 용도 → 모델·effort (사용자는 provider만 고른다)
  const useFor = options?.useFor ?? 'chat'; // 기본값은 chat (가장 빈번함)
  const provider = store.provider;
  const { model, effort } = resolveModelForUse(provider, useFor);

  // 3. API Key 우선순위
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
    reasoningEffort: effort,
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: 20,
  };
}

/**
 * 현재 전역 provider 기준의 용도별 API 모델 ID (표시/기록 전용).
 * 히스토리 스냅샷 설명처럼 "무엇으로 만들었는지"만 필요한 자리에서 쓴다.
 */
export function getModelIdForUse(useFor: ModelUseFor): string {
  return resolveModelForUse(useAiConfigStore.getState().provider, useFor).model;
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
  /** 실제 API 호출에 사용할 모델 ID */
  resolvedModel: string;
  /** 세션에 고정된 provider(없으면 전역 provider) */
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
 * @param options.provider 세션에 고정된 provider. 레거시 프리셋 ID도 정규화해서 받는다.
 * @param options.useFor 기본 'chat'. provider × 용도로 모델·effort가 결정된다.
 */
export function resolveModelRunConfig(options?: {
  provider?: string;
  useFor?: ModelUseFor;
}): ModelRunConfig {
  const store = useAiConfigStore.getState();
  const useFor = options?.useFor ?? 'chat';
  const provider = normalizeProvider(options?.provider) ?? store.provider;

  const { model, effort } = resolveModelForUse(provider, useFor);

  const openaiApiKey = store.openaiApiKey || getEnvApiKeyFallback('openai');
  const anthropicApiKey = store.anthropicApiKey || getEnvApiKeyFallback('anthropic');
  const temperature = getEnvOptionalNumber('VITE_AI_TEMPERATURE');

  return Object.freeze({
    resolvedModel: model,
    provider,
    reasoningEffort: effort,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    maxRecentMessages: 20,
  });
}
