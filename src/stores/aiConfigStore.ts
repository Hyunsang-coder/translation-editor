import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getSecureSecret, setSecureSecret, type SecureKeyId } from '@/tauri/secureStore';
// 타입 전용 import — 런타임 순환 참조(config.ts → aiConfigStore)가 생기지 않는다.
import type {
  ModelOverrideEntry,
  ModelOverrides,
  ModelUseFor,
  ReasoningEffort,
  SelectableProvider,
} from '@/ai/config';

const API_KEYS_BUNDLE_ID: SecureKeyId = 'api_keys_bundle';

/**
 * API Keys Bundle
 * - openai: OpenAI API Key
 * - anthropic: Anthropic API Key
 */
interface ApiKeysBundle {
  openai: string | undefined;
  anthropic: string | undefined;
}

interface AiConfigState {
  /**
   * 사용자가 고르는 유일한 AI 설정. 용도별 모델·effort는 `MODEL_BY_USE`가 고정한다
   * (ADR-0012). v13까지 있던 translationModel/chatModel을 대체한다.
   */
  provider: SelectableProvider;
  /**
   * 용도별 모델 직접 지정 (ADR-0017). 비어 있는 칸은 `MODEL_BY_USE` 기본값을 쓴다.
   *
   * **기본값을 여기에 복사해 두지 않는다.** 지정한 칸만 담아야 `MODEL_BY_USE`가 바뀔 때
   * 손대지 않은 용도가 따라 움직인다 — 전부 채워두면 단가·모델이 개편돼도 옛 값에 고정된다.
   */
  modelOverrides: ModelOverrides;
  // 사용자 입력 API Keys (OS 키체인/키링에 저장)
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  secureKeyPersistError: string | undefined;
  // NEW: 프로바이더 사용 여부 체크박스
  openaiEnabled: boolean;
  anthropicEnabled: boolean;
}

interface AiConfigActions {
  loadSecureKeys: () => Promise<void>;
  setProvider: (provider: SelectableProvider) => void;
  /** `model`이 `null`이면 모델 지정만 걷어낸다(effort 지정은 남는다). */
  setModelOverride: (
    provider: SelectableProvider,
    useFor: ModelUseFor,
    model: string | null,
  ) => void;
  /** `effort`가 `null`이면 effort 지정만 걷어낸다(모델 지정은 남는다). */
  setEffortOverride: (
    provider: SelectableProvider,
    useFor: ModelUseFor,
    effort: ReasoningEffort | null,
  ) => void;
  /** 모든 provider·용도의 지정을 한 번에 걷어낸다(UI의 "전체 초기화"). */
  clearModelOverrides: () => void;
  setOpenaiApiKey: (key: string | undefined) => void;
  setAnthropicApiKey: (key: string | undefined) => void;
  clearApiKeysAfterSecureStorageReset: () => void;
  // NEW: 프로바이더 enabled 설정
  setOpenaiEnabled: (enabled: boolean) => void;
  setAnthropicEnabled: (enabled: boolean) => void;
}

function normalizeKey(key: string | undefined): string | undefined {
  const trimmed = key?.trim();
  return trimmed ? trimmed : undefined;
}

/** Vite serve(dev)에서만 주입된 .env* 키 — Settings UI에도 보이도록 스토어에 soft-fill */
function getDevInjectedApiKeys(): { openai?: string; anthropic?: string } {
  if (!import.meta.env.DEV) return {};
  const openai = normalizeKey(
    typeof __DEV_OPENAI_API_KEY__ !== 'undefined' ? __DEV_OPENAI_API_KEY__ : undefined,
  );
  const anthropic = normalizeKey(
    typeof __DEV_ANTHROPIC_API_KEY__ !== 'undefined' ? __DEV_ANTHROPIC_API_KEY__ : undefined,
  );
  return {
    ...(openai ? { openai } : {}),
    ...(anthropic ? { anthropic } : {}),
  };
}

// 번들로 묶어서 저장하는 함수
async function persistAllKeys(keys: ApiKeysBundle): Promise<void> {
  const json = JSON.stringify(keys);
  await setSecureSecret(API_KEYS_BUNDLE_ID, json);
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  // Tauri command rejections surface the serialized CommandError plain object
  // ({ code, message, details }) rather than an Error instance, so extract its
  // fields explicitly to avoid rendering "[object Object]".
  if (err && typeof err === 'object') {
    const obj = err as { message?: unknown; details?: unknown; code?: unknown };
    if (typeof obj.message === 'string' && obj.message.trim()) {
      const detail =
        typeof obj.details === 'string' && obj.details.trim() ? ` (${obj.details})` : '';
      return obj.message + detail;
    }
    if (typeof obj.code === 'string' && obj.code.trim()) return obj.code;
    try {
      return JSON.stringify(err);
    } catch {
      // fall through to String() below
    }
  }
  return String(err);
}

let keysLoaded = false;
let loadingPromise: Promise<void> | null = null;
let persistVersion = 0;
let keyPersistQueue: Promise<void> = Promise.resolve();

function enqueuePersistAllKeys(
  keys: ApiKeysBundle,
  version: number,
  set: (partial: Partial<AiConfigState>) => void,
): void {
  keyPersistQueue = keyPersistQueue
    .catch(() => {
      // 이전 저장 실패가 이후 최신 저장을 막지 않도록 큐를 계속 진행합니다.
    })
    .then(async () => {
      if (version !== persistVersion) return;
      try {
        await persistAllKeys(keys);
        if (version === persistVersion) {
          set({ secureKeyPersistError: undefined });
        }
      } catch (err) {
        if (version !== persistVersion) return;
        const message = getErrorMessage(err);
        console.warn(`[aiConfigStore] Failed to persist API keys bundle:`, message);
        set({ secureKeyPersistError: message });
      }
    });
}

/**
 * 지정 한 칸의 필드 하나를 갈아끼운다. `null`을 주면 그 필드만 걷어낸다.
 *
 * 빈 항목을 `undefined`로 남기지 않고 키째 지운다 — localStorage 직렬화에서 undefined는
 * 사라지므로, 남겨 두면 메모리 상태와 hydrate 후 상태가 달라진다.
 */
function patchOverride(
  current: ModelOverrides,
  provider: SelectableProvider,
  useFor: ModelUseFor,
  patch: Partial<Record<keyof ModelOverrideEntry, string | null | undefined>>,
): ModelOverrides {
  const entry: ModelOverrideEntry = { ...(current[provider]?.[useFor] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value) entry[key as 'model'] = value as string;
    else delete entry[key as 'model'];
  }

  const { [useFor]: _dropped, ...restForProvider } = current[provider] ?? {};
  const nextForProvider =
    Object.keys(entry).length > 0 ? { ...restForProvider, [useFor]: entry } : restForProvider;

  const next: ModelOverrides = { ...current };
  if (Object.keys(nextForProvider).length > 0) next[provider] = nextForProvider;
  else delete next[provider];
  return next;
}

export function migrateAiConfig(
  persisted: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  const data = { ...persisted };
  if (version < 5) {
    const oldProvider = (data.provider as string) || 'openai';
    data.translationModel = (data.translationModel as string) || 'gpt-5.5';
    data.chatModel = (data.chatModel as string) || 'gpt-5.5';
    data.openaiEnabled = oldProvider !== 'anthropic';
    data.anthropicEnabled = oldProvider === 'anthropic';
  }
  if (version < 6) {
    const rename = (v: unknown) => v === 'claude-opus-4-5' ? 'claude-opus-4-6' : v;
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  if (version < 7) {
    const rename = (v: unknown) => v === 'claude-sonnet-4-5' ? 'claude-sonnet-4-6' : v;
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
    data.anthropicEnabled = true;
  }
  if (version < 8) {
    const rename = (v: unknown) => {
      if (v === 'gpt-5.2') return 'gpt-5.4';
      if (v === 'gpt-5-mini') return 'gpt-5.4-mini';
      return v;
    };
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  // v8 → v9: GPT-5.4 → 5.5, Opus 4.6 → 4.7
  if (version < 9) {
    const rename = (v: unknown) => {
      if (v === 'gpt-5.4') return 'gpt-5.5';
      if (v === 'claude-opus-4-6') return 'claude-opus-4-7';
      return v;
    };
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  // v9 → v10: Opus 4.7 → 4.8
  if (version < 10) {
    const rename = (v: unknown) => v === 'claude-opus-4-7' ? 'claude-opus-4-8' : v;
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  // v10 → v11: Sonnet 4.6 → Sonnet 5
  if (version < 11) {
    const rename = (v: unknown) => v === 'claude-sonnet-4-6' ? 'claude-sonnet-5' : v;
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  // v11 → v12: 기존 OpenAI 모델을 GPT-5.6 모델+추론 강도 프리셋으로 이전
  if (version < 12) {
    const rename = (v: unknown) => {
      if (v === 'gpt-5.5') return 'gpt-5.6-sol-high';
      if (v === 'gpt-5.4-mini') return 'gpt-5.6-luna-medium';
      return v;
    };
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  // v12 → v13: Opus 4.8 → Opus 5
  if (version < 13) {
    const rename = (v: unknown) => v === 'claude-opus-4-8' ? 'claude-opus-5' : v;
    data.translationModel = rename(data.translationModel);
    data.chatModel = rename(data.chatModel);
  }
  // v13 → v14: 프리셋 2개(translationModel/chatModel) → provider 1개 (ADR-0012)
  //
  // translationModel 기준으로 통일한다. 두 값의 provider가 엇갈릴 수 있지만
  // 문서 작업(번역·검수·폴리싱)이 주 용도이므로 그쪽을 살린다.
  if (version < 14) {
    const inferred =
      typeof data.translationModel === 'string' && data.translationModel
        ? data.translationModel
        : typeof data.chatModel === 'string'
          ? data.chatModel
          : '';
    data.provider = inferred && !inferred.startsWith('claude') ? 'openai' : 'anthropic';
    delete data.translationModel;
    delete data.chatModel;
  }
  // v14 → v15: 용도별 모델 직접 지정 도입 (ADR-0017).
  //
  // 기존 사용자는 지정 없음(= MODEL_BY_USE 기본값)에서 시작한다. 여기서 기본값을 채워
  // 넣으면 앱이 모델을 바꿔도 기존 사용자만 옛 모델에 고정되므로 반드시 비워 둔다.
  if (version < 15) {
    data.modelOverrides = {};
  }
  // v15 → v16: 지정 값이 모델 문자열 하나에서 `{model, effort}`로 넓어졌다 (ADR-0017).
  // v15는 당일 배포라 저장된 값이 거의 없지만, 있으면 모델 지정으로 옮긴다.
  if (version < 16) {
    const raw = data.modelOverrides;
    if (raw && typeof raw === 'object') {
      const migrated: Record<string, Record<string, { model: string }>> = {};
      for (const [provider, byUse] of Object.entries(raw as Record<string, unknown>)) {
        if (!byUse || typeof byUse !== 'object') continue;
        const entries: Record<string, { model: string }> = {};
        for (const [useFor, value] of Object.entries(byUse as Record<string, unknown>)) {
          if (typeof value === 'string' && value) entries[useFor] = { model: value };
        }
        if (Object.keys(entries).length > 0) migrated[provider] = entries;
      }
      data.modelOverrides = migrated;
    } else {
      data.modelOverrides = {};
    }
  }
  return data;
}

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set, get) => {
      return {
        provider: 'anthropic' as SelectableProvider,
        modelOverrides: {} as ModelOverrides,
        openaiApiKey: undefined,
        anthropicApiKey: undefined,
        secureKeyPersistError: undefined,
        openaiEnabled: false,
        anthropicEnabled: true,

        loadSecureKeys: async () => {
          // 이미 성공했으면 캐시 사용
          if (keysLoaded) return;
          // 이미 로딩 중이면 같은 프로미스 반환 (concurrent caller 대기)
          if (loadingPromise) return loadingPromise;

          loadingPromise = (async () => {
            try {
              // 1. 번들 로드 시도
              const bundleJson = await getSecureSecret(API_KEYS_BUNDLE_ID);

              if (bundleJson) {
                // 번들이 있으면 파싱해서 적용 (brave 키는 무시 - 제거됨)
                try {
                  const bundle = JSON.parse(bundleJson) as ApiKeysBundle & { brave?: string };
                  const devKeys = getDevInjectedApiKeys();
                  set({
                    openaiApiKey: normalizeKey(bundle.openai) || devKeys.openai,
                    anthropicApiKey: normalizeKey(bundle.anthropic) || devKeys.anthropic,
                  });
                  keysLoaded = true;  // ✅ 성공 후에만 true
                  return; // 로드 완료
                } catch (e) {
                  // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
                  const message = e instanceof Error ? e.message : String(e);
                  console.error('[aiConfigStore] Failed to parse API keys bundle:', message);
                }
              }

              // 2. 번들이 없으면 마이그레이션 (개별 키 로드 -> 번들 저장)
              // brave 키는 제거됨 - 레거시 호환성을 위해 로드는 하되 무시
              const oldKinds: SecureKeyId[] = ['openai', 'anthropic'];
              const newBundle: ApiKeysBundle = {
                openai: undefined,
                anthropic: undefined,
              };
              let hasLegacyKey = false;

              for (const kind of oldKinds) {
                if (kind === 'api_keys_bundle') continue;
                const val = await getSecureSecret(kind);
                if (val) {
                  hasLegacyKey = true;
                  if (kind === 'openai') newBundle.openai = val;
                  if (kind === 'anthropic') newBundle.anthropic = val;
                }
              }

              if (hasLegacyKey) {
                set({
                  openaiApiKey: newBundle.openai,
                  anthropicApiKey: newBundle.anthropic,
                });
                await persistAllKeys(newBundle);
              } else {
                // 3. vault/레거시 키가 없으면 dev(.env*) 키를 세션에만 반영 (persist 없음)
                const devKeys = getDevInjectedApiKeys();
                if (devKeys.openai || devKeys.anthropic) {
                  set({
                    openaiApiKey: devKeys.openai,
                    anthropicApiKey: devKeys.anthropic,
                  });
                }
              }

              keysLoaded = true;  // ✅ 마이그레이션도 성공
            } catch (err) {
              // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
              const message = getErrorMessage(err);
              console.warn(`[aiConfigStore] Failed to load secure keys:`, message);
              // keysLoaded remains false → 재시도 가능
              // vault 실패해도 dev 키는 사용 가능하게 soft-fill
              const devKeys = getDevInjectedApiKeys();
              if (devKeys.openai || devKeys.anthropic) {
                set({
                  openaiApiKey: get().openaiApiKey || devKeys.openai,
                  anthropicApiKey: get().anthropicApiKey || devKeys.anthropic,
                });
              }
            } finally {
              loadingPromise = null;
            }
          })();

          return loadingPromise;
        },

        setProvider: (provider) => set({ provider }),

        setModelOverride: (provider, useFor, model) =>
          set({ modelOverrides: patchOverride(get().modelOverrides, provider, useFor, { model }) }),

        setEffortOverride: (provider, useFor, effort) =>
          set({ modelOverrides: patchOverride(get().modelOverrides, provider, useFor, { effort }) }),

        clearModelOverrides: () => set({ modelOverrides: {} }),

        setOpenaiApiKey: (key) => {
          const version = ++persistVersion;
          const next = normalizeKey(key);
          set({ openaiApiKey: next, secureKeyPersistError: undefined });
          const state = get();
          enqueuePersistAllKeys({
            openai: next,
            anthropic: state.anthropicApiKey,
          }, version, set);
        },
        setAnthropicApiKey: (key) => {
          const version = ++persistVersion;
          const next = normalizeKey(key);
          set({ anthropicApiKey: next, secureKeyPersistError: undefined });
          const state = get();
          enqueuePersistAllKeys({
            openai: state.openaiApiKey,
            anthropic: next,
          }, version, set);
          // API Key 삭제 시 해당 provider 비활성화.
          // provider 선택도 함께 넘긴다 — 안 그러면 "비활성 provider가 선택된" 상태로 남아
          // 모든 AI 호출이 키 없음으로 실패한다(조건상 openaiEnabled는 true).
          if (!next && state.anthropicEnabled && state.openaiEnabled) {
            set({
              anthropicEnabled: false,
              ...(state.provider === 'anthropic' ? { provider: 'openai' as const } : {}),
            });
          }
        },

        clearApiKeysAfterSecureStorageReset: () => {
          persistVersion += 1;
          keysLoaded = false;
          loadingPromise = null;
          set({
            openaiApiKey: undefined,
            anthropicApiKey: undefined,
            secureKeyPersistError: undefined,
            openaiEnabled: false,
            anthropicEnabled: true,
            // openaiEnabled=false로 되돌리므로 provider도 함께 기본값으로 (불일치 방지)
            provider: 'anthropic',
          });
        },

        setOpenaiEnabled: (enabled) => {
          const state = get();
          // 최소 하나는 활성화 필수
          if (!enabled && !state.anthropicEnabled) {
            console.warn('[aiConfigStore] At least one provider must be enabled');
            return;
          }
          set({ openaiEnabled: enabled });
          // 비활성화한 provider가 선택돼 있었으면 남은 provider로 넘긴다
          if (!enabled && state.provider === 'openai') {
            set({ provider: 'anthropic' });
          }
        },

        setAnthropicEnabled: (enabled) => {
          const state = get();
          // 최소 하나는 활성화 필수
          if (!enabled && !state.openaiEnabled) {
            console.warn('[aiConfigStore] At least one provider must be enabled');
            return;
          }
          set({ anthropicEnabled: enabled });
          // 비활성화한 provider가 선택돼 있었으면 남은 provider로 넘긴다
          if (!enabled && state.provider === 'anthropic') {
            set({ provider: 'openai' });
          }
        },
      };
    },
    {
      name: 'ite-ai-config',
      version: 16,
      migrate: (persisted: unknown, version: number) =>
        migrateAiConfig(persisted as Record<string, unknown>, version),
      partialize: (state) => ({
        provider: state.provider,
        modelOverrides: state.modelOverrides,
        openaiEnabled: state.openaiEnabled,
        anthropicEnabled: state.anthropicEnabled,
      }),
      merge: (persisted, current) => {
        const next = { ...current, ...(persisted as Partial<AiConfigState>) };
        return {
          ...next,
          openaiApiKey: undefined,
          anthropicApiKey: undefined,
        };
      },
    }
  )
);
