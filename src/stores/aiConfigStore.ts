import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiProvider } from '@/ai/config';
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
  provider: AiProvider;
  // 번역용 모델 (예: gpt-5.2)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-5-mini)
  chatModel: string;
  // 사용자 입력 API Keys (OS 키체인/키링에 저장)
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
}

interface AiConfigActions {
  loadSecureKeys: () => Promise<void>;
  setProvider: (provider: AiProvider) => void;
  setTranslationModel: (model: string) => void;
  setChatModel: (model: string) => void;
  setOpenaiApiKey: (key: string | undefined) => void;
  setAnthropicApiKey: (key: string | undefined) => void;
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
    console.warn(`[aiConfigStore] Failed to persist API keys bundle:`, err);
  }
}

let keysLoaded = false;

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set, get) => {
      // 초기값 결정 로직 - OpenAI 전용으로 단순화
      const envProvider = (getEnv('VITE_AI_PROVIDER', 'openai') as string).toLowerCase();
      const validProvider: AiProvider = envProvider === 'mock' ? 'mock' : 'openai';

      // 환경변수 VITE_AI_MODEL이 있으면 사용, 없으면 기본값
      const envModel = getEnv('VITE_AI_MODEL', '');
      const defaultTranslationModel = envModel || 'gpt-5.2';
      const defaultChatModel = envModel || 'gpt-5.2';

      return {
        provider: validProvider,
        translationModel: defaultTranslationModel,
        chatModel: defaultChatModel,
        openaiApiKey: undefined,
        anthropicApiKey: undefined,

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
                console.error('[aiConfigStore] Failed to parse API keys bundle', e);
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
            console.warn(`[aiConfigStore] Failed to load secure keys:`, err);
          }
        },

        setProvider: (provider) => {
          // Provider 전환 시 모델을 해당 provider의 기본값으로 변경
          // MODEL_PRESETS를 직접 정의하여 순환 참조 회피
          const MODEL_PRESETS: Record<string, Array<{ value: string }>> = {
            openai: [
              { value: 'gpt-5.2' },
              { value: 'gpt-5-mini' },
              { value: 'gpt-5-nano' },
            ],
            anthropic: [
              { value: 'claude-sonnet-4-5' },
              { value: 'claude-haiku-4-5' },
              { value: 'claude-opus-4-5' },
            ],
          };
          const presetKey = provider === 'mock' ? 'openai' : provider;
          const presets = MODEL_PRESETS[presetKey] ?? MODEL_PRESETS.openai;
          const defaultModel = presets?.[0]?.value ?? 'gpt-5.2';
          set({
            provider,
            translationModel: defaultModel,
            chatModel: defaultModel,
          });
          void get().loadSecureKeys();
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
        },
      };
    },
    {
      name: 'ite-ai-config',
      version: 4, // 버전 업: Anthropic 지원 추가
      partialize: (state) => ({
        provider: state.provider,
        translationModel: state.translationModel,
        chatModel: state.chatModel,
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
