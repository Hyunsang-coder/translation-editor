import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiProvider } from '@/ai/config';
import { getSecureSecret, setSecureSecret, type SecureKeyId } from '@/tauri/secureStore';

const API_KEYS_BUNDLE_ID: SecureKeyId = 'api_keys_bundle';

/**
 * API Keys Bundle - OpenAI 전용으로 단순화
 * - openai: 필수
 * - brave: 선택 (웹검색 폴백용)
 */
interface ApiKeysBundle {
  openai: string | undefined;
  brave: string | undefined;
}

interface AiConfigState {
  provider: AiProvider;
  // 번역용 모델 (예: gpt-5.2)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-5-mini)
  chatModel: string;
  // 사용자 입력 API Keys (OS 키체인/키링에 저장)
  openaiApiKey: string | undefined;
  braveApiKey: string | undefined;
}

interface AiConfigActions {
  loadSecureKeys: () => Promise<void>;
  setProvider: (provider: AiProvider) => void;
  setTranslationModel: (model: string) => void;
  setChatModel: (model: string) => void;
  setOpenaiApiKey: (key: string | undefined) => void;
  setBraveApiKey: (key: string | undefined) => void;
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
        braveApiKey: undefined,

        loadSecureKeys: async () => {
          if (keysLoaded) return;
          keysLoaded = true;

          try {
            // 1. 번들 로드 시도
            const bundleJson = await getSecureSecret(API_KEYS_BUNDLE_ID);
            
            if (bundleJson) {
              // 번들이 있으면 파싱해서 적용
              try {
                const bundle = JSON.parse(bundleJson) as ApiKeysBundle;
                set({
                  openaiApiKey: bundle.openai,
                  braveApiKey: bundle.brave,
                });
                return; // 로드 완료
              } catch (e) {
                console.error('[aiConfigStore] Failed to parse API keys bundle', e);
              }
            }

            // 2. 번들이 없으면 마이그레이션 (개별 키 로드 -> 번들 저장)
            const oldKinds: SecureKeyId[] = ['openai', 'brave'];
            const newBundle: ApiKeysBundle = {
              openai: undefined,
              brave: undefined
            };
            let hasLegacyKey = false;

            for (const kind of oldKinds) {
              if (kind === 'api_keys_bundle') continue;
              const val = await getSecureSecret(kind);
              if (val) {
                hasLegacyKey = true;
                if (kind === 'openai') newBundle.openai = val;
                if (kind === 'brave') newBundle.brave = val;
              }
            }

            if (hasLegacyKey) {
              set({
                openaiApiKey: newBundle.openai,
                braveApiKey: newBundle.brave,
              });
              await persistAllKeys(newBundle);
            }

          } catch (err) {
            console.warn(`[aiConfigStore] Failed to load secure keys:`, err);
          }
        },

        setProvider: (provider) => {
          set({ provider });
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
            brave: state.braveApiKey,
          });
        },
        setBraveApiKey: (key) => {
          const next = normalizeKey(key);
          set({ braveApiKey: next });
          const state = get();
          void persistAllKeys({
            openai: state.openaiApiKey,
            brave: next,
          });
        },
      };
    },
    {
      name: 'ite-ai-config',
      version: 3, // 버전 업: Anthropic/Google 제거로 인한 스키마 변경
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
          braveApiKey: undefined,
        };
      },
    }
  )
);
