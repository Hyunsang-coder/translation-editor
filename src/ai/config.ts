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
    // Sol이 아니라 Terra다. 검수는 문서 전체를 넣는 경로라 long-context recall이 관건인데
    // Terra는 그 축에서 Sol과 사실상 동급(MRCR 256K–512K 89.6 vs 91.5)이면서 단가가 40%다.
    // Luna는 같은 축에서 41.3으로 무너져 검수·번역 용도 후보가 아니다.
    review: { model: 'gpt-5.6-terra', effort: 'high' },
    polish: { model: 'gpt-5.6-luna', effort: 'high' },
    chat: { model: 'gpt-5.6-luna', effort: 'high' },
    summary: { model: 'gpt-5.6-luna', effort: 'medium' },
  },
};

export const PROVIDER_LABELS: Readonly<Record<SelectableProvider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/**
 * 사용자가 용도별로 **직접 고를 수 있는** 모델 목록 (ADR-0017).
 *
 * 자유 입력이 아니라 목록인 이유가 두 가지다:
 * - `resolveModelCallOptions`가 모델 ID prefix로 파라미터 지원을 판정한다. 목록 밖 모델에
 *   effort/temperature를 보내면 400이 난다.
 * - `MODEL_PRICES`에 단가가 없으면 사용량 화면이 "가격 미상"으로 빠져 비교가 불가능해진다.
 *   이 목록의 모든 모델에 단가가 있는지는 `pricing.test.ts`가 검사한다.
 *
 * 첫 항목이 그 provider의 기본값이 아니라는 점에 주의 — 기본값은 항상 `MODEL_BY_USE`다.
 */
export const MODEL_CHOICES: Readonly<Record<SelectableProvider, readonly string[]>> = {
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
};

/**
 * 사용자가 고를 수 있는 추론 강도 (ADR-0017).
 *
 * `xhigh`/`max`는 의도적으로 뺐다. 지금의 `maxTokens` 예산이 전부 `high` 기준으로 잡혀 있는데
 * 그 예산은 **thinking을 포함**하므로(gotchas #150), 더 올리면 검수(16,384)·선택 재번역(16,384)
 * 같은 마커 워크플로가 `---X_END---` 전에 잘려 파싱이 실패한다. 올리려면 예산도 함께 올릴 것.
 */
export const EFFORT_CHOICES: readonly ReasoningEffort[] = ['medium', 'high'];

/** provider × 용도 → 사용자가 지정한 값. 지정이 없는 칸·필드는 비어 있다. */
export type ModelOverrideEntry = { model?: string; effort?: ReasoningEffort };
export type ModelOverrides = Partial<
  Record<SelectableProvider, Partial<Record<ModelUseFor, ModelOverrideEntry>>>
>;

/**
 * 지정 모델이 목록에 있을 때만 통과시킨다.
 *
 * 저장된 값은 localStorage라 손으로 고쳐질 수 있고, 모델이 목록에서 빠지는 일도 있다.
 * 그 경우 조용히 기본값으로 돌아간다 — ADR-0012가 없앤 `presets[0]` fallback과 달리
 * 여기서는 **앱이 고정한 기본값**으로 떨어지므로 "모르는 모델로 튀는" 경로가 없다.
 */
function pickModel(
  provider: SelectableProvider,
  useFor: ModelUseFor,
  overrides: ModelOverrides | undefined,
): string | null {
  const model = overrides?.[provider]?.[useFor]?.model;
  if (!model) return null;
  return MODEL_CHOICES[provider].includes(model) ? model : null;
}

/** 지정 effort가 목록에 있을 때만 통과시킨다. 모델과 같은 이유로 검증한다. */
function pickEffort(
  provider: SelectableProvider,
  useFor: ModelUseFor,
  overrides: ModelOverrides | undefined,
): ReasoningEffort | null {
  const effort = overrides?.[provider]?.[useFor]?.effort;
  if (!effort) return null;
  return EFFORT_CHOICES.includes(effort) ? effort : null;
}

/**
 * provider × 용도 → 모델·effort.
 *
 * `overrides`의 두 필드는 서로 독립이다 — 모델만, effort만, 둘 다 지정할 수 있고
 * 지정하지 않은 쪽은 `MODEL_BY_USE`가 계속 고정한다.
 */
export function resolveModelForUse(
  provider: SelectableProvider,
  useFor: ModelUseFor,
  overrides?: ModelOverrides,
): ModelSpec {
  const base = MODEL_BY_USE[provider][useFor];
  const model = pickModel(provider, useFor, overrides);
  const effort = pickEffort(provider, useFor, overrides);
  if (!model && !effort) return base;
  return { model: model ?? base.model, effort: effort ?? base.effort };
}

/**
 * 세션 pin에서 provider와 모델을 가르는 구분자.
 *
 * `chat_sessions.model_preset`은 `"anthropic"`(지정 없음) 또는
 * `"anthropic#claude-haiku-4-5"`(세션 생성 시점의 채팅 모델 스냅샷) 둘 중 하나다.
 * 컬럼을 늘리지 않고 값 의미만 확장했다 — ADR-0012에서 rename을 보류한 것과 같은 이유다.
 */
const SESSION_PIN_SEP = '#';

/**
 * 저장된 값(현재 pin, 또는 v13 이전 프리셋 ID)을 provider로 정규화한다.
 *
 * 세션 pin(`chat_sessions.model_preset`)과 과거 메시지의 `requestedModelPreset`에는
 * `claude-sonnet-5` 같은 프리셋 ID가 남아 있다. 그대로 매핑 키로 쓰면 undefined를
 * 인덱싱하게 되므로 읽는 지점에서 반드시 통과시킨다.
 * 구분자 뒤의 모델 스냅샷은 여기서 잘라낸다.
 */
export function normalizeProvider(value: string | undefined | null): SelectableProvider | null {
  if (!value) return null;
  const head = value.split(SESSION_PIN_SEP, 1)[0]!;
  if (head === 'anthropic' || head === 'openai') return head;
  return head.startsWith('claude') ? 'anthropic' : 'openai';
}

/**
 * 세션 pin에 박힌 채팅 지정. 지정 없이 만들어진 세션이면 두 필드 모두 `null`.
 *
 * 이 스냅샷이 있어야 "채팅 설정 변경은 새 대화부터"가 실제로 지켜진다. 매번 현재 설정을
 * 읽으면 진행 중 대화의 모델·effort가 바뀌어 프롬프트 캐시가 깨진다(모델은 프리픽스 전체,
 * effort는 messages 구간). ADR-0012에서 세션 pin을 첫 메시지 이후 잠근 이유와 같다.
 *
 * 형식은 `provider[#model[#effort]]`이고 빈 구간을 허용한다 — effort만 지정한 세션은
 * `anthropic##medium`이 된다.
 */
export function pinnedChatSpec(value: string | undefined | null): {
  model: string | null;
  effort: ReasoningEffort | null;
} {
  const empty = { model: null, effort: null };
  if (!value) return empty;
  const [, rawModel, rawEffort] = value.split(SESSION_PIN_SEP);
  const provider = normalizeProvider(value);
  if (!provider) return empty;

  const model = rawModel && MODEL_CHOICES[provider].includes(rawModel) ? rawModel : null;
  const effort = EFFORT_CHOICES.includes(rawEffort as ReasoningEffort)
    ? (rawEffort as ReasoningEffort)
    : null;
  return { model, effort };
}

/** 세션 생성 시점의 provider·채팅 지정을 pin 문자열로 굳힌다. */
export function buildSessionPin(
  provider: SelectableProvider,
  overrides?: ModelOverrides,
): string {
  const model = pickModel(provider, 'chat', overrides);
  const effort = pickEffort(provider, 'chat', overrides);
  if (!model && !effort) return provider;
  // effort만 지정된 경우 모델 구간을 비워 둔다 — 자리를 지켜야 파싱 위치가 안 흔들린다.
  return [provider, model ?? '', ...(effort ? [effort] : [])].join(SESSION_PIN_SEP);
}

/**
 * 저장된 pin을 정규 형태로 고친다. 이미 정규형이면 **같은 문자열을 그대로** 돌려준다.
 *
 * hydrate 시 세션 pin을 되쓰는 경로가 이 함수로 "바뀐 게 있는지"를 판정하므로, 모델
 * 스냅샷이 붙은 pin을 provider만 남기고 깎아내지 않는 것이 중요하다 — 깎으면 진행 중
 * 대화가 다음 실행에서 현재 설정의 모델로 갈아타고 캐시 프리픽스를 버린다.
 */
export function normalizeSessionPin(
  value: string | undefined | null,
  fallbackProvider: SelectableProvider,
): string {
  const provider = normalizeProvider(value) ?? fallbackProvider;
  const { model, effort } = pinnedChatSpec(value);
  if (!model && !effort) return provider;
  return [provider, model ?? '', ...(effort ? [effort] : [])].join(SESSION_PIN_SEP);
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
  const { model, effort } = resolveModelForUse(provider, useFor, store.modelOverrides);

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
 * 저장된 지정까지 반영한 용도별 모델·effort.
 *
 * `resolveModelForUse`는 지정을 **인자로** 받는 순수 함수라, 호출부가 스토어 읽기를 잊으면
 * 지정이 조용히 무시된다(요약 경로가 실제로 그랬다). 스토어를 읽어야 하는 자리는 이 함수를 쓸 것.
 */
export function getModelSpecForUse(
  provider: SelectableProvider,
  useFor: ModelUseFor,
): ModelSpec {
  return resolveModelForUse(provider, useFor, useAiConfigStore.getState().modelOverrides);
}

/**
 * 현재 전역 provider 기준의 용도별 API 모델 ID (표시/기록 전용).
 * 히스토리 스냅샷 설명처럼 "무엇으로 만들었는지"만 필요한 자리에서 쓴다.
 */
export function getModelIdForUse(useFor: ModelUseFor): string {
  const { provider, modelOverrides } = useAiConfigStore.getState();
  return resolveModelForUse(provider, useFor, modelOverrides).model;
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

  // 채팅에 세션 pin이 있으면 **그 pin이 유일한 권위**다. 현재 지정은 보지 않는다.
  //
  // 스냅샷이 없는 pin("anthropic")은 "지정 없이 시작한 세션"이라는 뜻이므로 기본값으로 간다.
  // 여기서 현재 지정으로 떨어지면, 지정을 켜기 전에 만들어진 세션이 전부 다음 턴에 모델을
  // 갈아타 프롬프트 캐시 프리픽스를 버린다 — 스냅샷으로 막으려던 바로 그 일이다.
  // 다른 용도는 요청마다 독립이라 해당 없고, pin이 아예 없는 호출도 현재 지정을 따른다.
  const chatPin = useFor === 'chat' ? (options?.provider ?? null) : null;
  const base = chatPin
    ? MODEL_BY_USE[provider][useFor]
    : resolveModelForUse(provider, useFor, store.modelOverrides);
  const pinned = chatPin ? pinnedChatSpec(chatPin) : { model: null, effort: null };
  const model = pinned.model ?? base.model;
  const effort = pinned.effort ?? base.effort;

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
