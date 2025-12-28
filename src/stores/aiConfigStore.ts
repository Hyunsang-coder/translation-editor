import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiProvider } from '@/ai/config';
import { deleteSecureSecret, getSecureSecret, setSecureSecret, type SecureKeyId } from '@/tauri/secureStore';

interface AiConfigState {
  provider: AiProvider;
  // 번역용 모델 (예: gpt-4o, claude-3-5-sonnet)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-4o-mini, claude-3-5-haiku)
  chatModel: string;
  // 사용자 입력 API Keys (선택적, OS 키체인/키링에 저장)
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  googleApiKey: string | undefined;
  braveApiKey: string | undefined;
}

interface AiConfigActions {
  loadSecureKeys: () => Promise<void>;
  setProvider: (provider: AiProvider) => void;
  setTranslationModel: (model: string) => void;
  setChatModel: (model: string) => void;
  setOpenaiApiKey: (key: string | undefined) => void;
  setAnthropicApiKey: (key: string | undefined) => void;
  setGoogleApiKey: (key: string | undefined) => void;
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

const secureKeyLoaded: Record<SecureKeyId, boolean> = {
  openai: false,
  anthropic: false,
  google: false,
  brave: false,
};

function getProviderKey(provider: AiProvider): SecureKeyId | null {
  if (provider === 'openai' || provider === 'anthropic' || provider === 'google') {
    return provider;
  }
  return null;
}

async function persistSecureKey(kind: SecureKeyId, value: string | undefined): Promise<void> {
  try {
    if (value) {
      await setSecureSecret(kind, value);
    } else {
      await deleteSecureSecret(kind);
    }
  } catch (err) {
    console.warn(`[aiConfigStore] Failed to persist ${kind} API key:`, err);
  }
}

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set, get) => {
      // 초기값 결정 로직
      const defaultProvider = (getEnv('VITE_AI_PROVIDER', 'openai') as AiProvider).toLowerCase() as AiProvider;
      const validProvider = ['openai', 'anthropic', 'google', 'mock'].includes(defaultProvider) ? defaultProvider : 'openai';

      // 환경변수 VITE_AI_MODEL이 있으면 그걸 우선으로 둘 다 설정, 없으면 Provider별 기본값
      const envModel = getEnv('VITE_AI_MODEL', '');
      
      let defaultTranslationModel = envModel;
      let defaultChatModel = envModel;

      if (!envModel) {
        if (validProvider === 'anthropic') {
          defaultTranslationModel = 'claude-3-5-sonnet-latest';
          defaultChatModel = 'claude-3-5-haiku-latest';
        } else if (validProvider === 'google') {
          defaultTranslationModel = 'gemini-2.5-pro';
          defaultChatModel = 'gemini-2.5-flash';
        } else {
          // openai or mock
          defaultTranslationModel = 'gpt-5.2';
          defaultChatModel = 'gpt-5.2';
        }
      }

      return {
        provider: validProvider,
        translationModel: defaultTranslationModel,
        chatModel: defaultChatModel,
        openaiApiKey: undefined,
        anthropicApiKey: undefined,
        googleApiKey: undefined,
        braveApiKey: undefined,

        loadSecureKeys: async () => {
          const providerKey = getProviderKey(get().provider);
          if (!providerKey || secureKeyLoaded[providerKey]) return;
          try {
            const value = await getSecureSecret(providerKey);
            secureKeyLoaded[providerKey] = true;
            if (!value) return;
            if (providerKey === 'openai') set({ openaiApiKey: value });
            if (providerKey === 'anthropic') set({ anthropicApiKey: value });
            if (providerKey === 'google') set({ googleApiKey: value });
          } catch (err) {
            console.warn(`[aiConfigStore] Failed to load ${providerKey} API key:`, err);
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
          void persistSecureKey('openai', next);
        },
        setAnthropicApiKey: (key) => {
          const next = normalizeKey(key);
          set({ anthropicApiKey: next });
          void persistSecureKey('anthropic', next);
        },
        setGoogleApiKey: (key) => {
          const next = normalizeKey(key);
          set({ googleApiKey: next });
          void persistSecureKey('google', next);
        },
        setBraveApiKey: (key) => {
          const next = normalizeKey(key);
          set({ braveApiKey: next });
          void persistSecureKey('brave', next);
        },
      };
    },
    {
      name: 'ite-ai-config',
      version: 2,
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
          googleApiKey: undefined,
          braveApiKey: undefined,
        };
      },
    }
  )
);
