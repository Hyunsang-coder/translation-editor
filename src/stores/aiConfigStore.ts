import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getSecureSecret, setSecureSecret, type SecureKeyId } from '@/tauri/secureStore';

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
  // 번역용 모델 (예: gpt-5.5)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-5.4-mini)
  chatModel: string;
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
  setTranslationModel: (model: string) => void;
  setChatModel: (model: string) => void;
  setOpenaiApiKey: (key: string | undefined) => void;
  setAnthropicApiKey: (key: string | undefined) => void;
  clearApiKeysAfterSecureStorageReset: () => void;
  // NEW: 프로바이더 enabled 설정
  setOpenaiEnabled: (enabled: boolean) => void;
  setAnthropicEnabled: (enabled: boolean) => void;
}

// 환경변수 읽기 헬퍼
function getEnv(key: string, def: string): string {
  return (import.meta.env[key] as string) || def;
}

function normalizeKey(key: string | undefined): string | undefined {
  const trimmed = key?.trim();
  return trimmed ? trimmed : undefined;
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

// MODEL_PRESETS 정의 (순환 참조 회피)
const MODEL_PRESETS: Record<string, Array<{ value: string }>> = {
  openai: [
    { value: 'gpt-5.5' },
    { value: 'gpt-5.4-mini' },
  ],
  anthropic: [
    { value: 'claude-sonnet-5' },
    { value: 'claude-haiku-4-5' },
    { value: 'claude-opus-4-8' },
  ],
};

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
  return data;
}

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set, get) => {
      // 환경변수 VITE_AI_MODEL이 있으면 사용, 없으면 기본값
      const envModel = getEnv('VITE_AI_MODEL', '');
      const defaultTranslationModel = envModel || 'claude-sonnet-5';
      const defaultChatModel = envModel || 'claude-sonnet-5';

      return {
        translationModel: defaultTranslationModel,
        chatModel: defaultChatModel,
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
                  set({
                    openaiApiKey: bundle.openai,
                    anthropicApiKey: bundle.anthropic,
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
              }

              keysLoaded = true;  // ✅ 마이그레이션도 성공
            } catch (err) {
              // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
              const message = getErrorMessage(err);
              console.warn(`[aiConfigStore] Failed to load secure keys:`, message);
              // keysLoaded remains false → 재시도 가능
            } finally {
              loadingPromise = null;
            }
          })();

          return loadingPromise;
        },

        setTranslationModel: (model) => set({ translationModel: model }),
        setChatModel: (model) => set({ chatModel: model }),

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
          // API Key 삭제 시 해당 provider 비활성화
          if (!next && state.anthropicEnabled && state.openaiEnabled) {
            set({ anthropicEnabled: false });
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
          // 비활성화 시 선택된 모델이 해당 provider면 다른 provider의 첫 모델로 변경
          if (!enabled) {
            const anthropicPresets = MODEL_PRESETS.anthropic;
            const firstAnthropicModel = anthropicPresets?.[0]?.value ?? 'claude-sonnet-5';
            if (!state.translationModel.startsWith('claude')) {
              set({ translationModel: firstAnthropicModel });
            }
            if (!state.chatModel.startsWith('claude')) {
              set({ chatModel: firstAnthropicModel });
            }
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
          // 비활성화 시 선택된 모델이 해당 provider면 다른 provider의 첫 모델로 변경
          if (!enabled) {
            const openaiPresets = MODEL_PRESETS.openai;
            const firstOpenaiModel = openaiPresets?.[0]?.value ?? 'gpt-5.5';
            if (state.translationModel.startsWith('claude')) {
              set({ translationModel: firstOpenaiModel });
            }
            if (state.chatModel.startsWith('claude')) {
              set({ chatModel: firstOpenaiModel });
            }
          }
        },
      };
    },
    {
      name: 'ite-ai-config',
      version: 11,
      migrate: (persisted: unknown, version: number) =>
        migrateAiConfig(persisted as Record<string, unknown>, version),
      partialize: (state) => ({
        translationModel: state.translationModel,
        chatModel: state.chatModel,
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
