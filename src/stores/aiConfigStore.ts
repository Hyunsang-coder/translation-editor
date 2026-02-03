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
  // 번역용 모델 (예: gpt-5.2)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-5-mini)
  chatModel: string;
  // 사용자 입력 API Keys (OS 키체인/키링에 저장)
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
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
  try {
    const json = JSON.stringify(keys);
    await setSecureSecret(API_KEYS_BUNDLE_ID, json);
  } catch (err) {
    // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[aiConfigStore] Failed to persist API keys bundle:`, message);
  }
}

let keysLoaded = false;

// MODEL_PRESETS 정의 (순환 참조 회피)
const MODEL_PRESETS: Record<string, Array<{ value: string }>> = {
  openai: [
    { value: 'gpt-5.2' },
    { value: 'gpt-5-mini' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5' },
    { value: 'claude-haiku-4-5' },
    { value: 'claude-opus-4-5' },
  ],
};

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set, get) => {
      // 환경변수 VITE_AI_MODEL이 있으면 사용, 없으면 기본값
      const envModel = getEnv('VITE_AI_MODEL', '');
      const defaultTranslationModel = envModel || 'gpt-5.2';
      const defaultChatModel = envModel || 'gpt-5.2';

      return {
        translationModel: defaultTranslationModel,
        chatModel: defaultChatModel,
        openaiApiKey: undefined,
        anthropicApiKey: undefined,
        // 기본값: OpenAI만 활성화
        openaiEnabled: true,
        anthropicEnabled: false,

        loadSecureKeys: async () => {
          if (keysLoaded) return;
          keysLoaded = true;

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

          } catch (err) {
            // 에러 객체 전체 로깅 시 민감 정보 노출 위험 방지
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[aiConfigStore] Failed to load secure keys:`, message);
          }
        },

        setTranslationModel: (model) => set({ translationModel: model }),
        setChatModel: (model) => set({ chatModel: model }),

        setOpenaiApiKey: (key) => {
          const next = normalizeKey(key);
          set({ openaiApiKey: next });
          const state = get();
          void persistAllKeys({
            openai: next,
            anthropic: state.anthropicApiKey,
          });
        },
        setAnthropicApiKey: (key) => {
          const next = normalizeKey(key);
          set({ anthropicApiKey: next });
          const state = get();
          void persistAllKeys({
            openai: state.openaiApiKey,
            anthropic: next,
          });
          // API Key 삭제 시 해당 provider 비활성화
          if (!next && state.anthropicEnabled && state.openaiEnabled) {
            set({ anthropicEnabled: false });
          }
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
            const firstAnthropicModel = anthropicPresets?.[0]?.value ?? 'claude-sonnet-4-5';
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
            const firstOpenaiModel = openaiPresets?.[0]?.value ?? 'gpt-5.2';
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
      version: 5, // 버전 업: Multi-provider 지원 (provider 필드 제거)
      migrate: (persisted: unknown, version: number) => {
        const data = persisted as Record<string, unknown>;
        if (version < 5) {
          // v4 → v5 마이그레이션: provider 기반으로 enabled 설정
          const oldProvider = (data.provider as string) || 'openai';
          return {
            translationModel: (data.translationModel as string) || 'gpt-5.2',
            chatModel: (data.chatModel as string) || 'gpt-5.2',
            // 기존 provider 기반으로 enabled 설정
            openaiEnabled: oldProvider !== 'anthropic',  // anthropic이 아니면 true
            anthropicEnabled: oldProvider === 'anthropic',
          };
        }
        return data;
      },
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
