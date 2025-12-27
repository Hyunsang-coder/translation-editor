import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiProvider } from '@/ai/config';

interface AiConfigState {
  provider: AiProvider;
  // 번역용 모델 (예: gpt-4o, claude-3-5-sonnet)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-4o-mini, claude-3-5-haiku)
  chatModel: string;
  // 사용자 입력 API Keys (선택적, localStorage에 저장)
  openaiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  googleApiKey: string | undefined;
  braveApiKey: string | undefined;
}

interface AiConfigActions {
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

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set) => {
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

        setProvider: (provider) => set({ provider }),
        setTranslationModel: (model) => set({ translationModel: model }),
        setChatModel: (model) => set({ chatModel: model }),
        setOpenaiApiKey: (key) => set({ openaiApiKey: key?.trim() || undefined }),
        setAnthropicApiKey: (key) => set({ anthropicApiKey: key?.trim() || undefined }),
        setGoogleApiKey: (key) => set({ googleApiKey: key?.trim() || undefined }),
        setBraveApiKey: (key) => set({ braveApiKey: key?.trim() || undefined }),
      };
    },
    {
      name: 'ite-ai-config',
    }
  )
);
