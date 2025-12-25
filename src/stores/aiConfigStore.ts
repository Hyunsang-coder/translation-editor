import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiProvider } from '@/ai/config';

interface AiConfigState {
  provider: AiProvider;
  // 번역용 모델 (예: gpt-4o, claude-3-5-sonnet)
  translationModel: string;
  // 채팅/질문용 모델 (예: gpt-4o-mini, claude-3-5-haiku)
  chatModel: string;
}

interface AiConfigActions {
  setProvider: (provider: AiProvider) => void;
  setTranslationModel: (model: string) => void;
  setChatModel: (model: string) => void;
}

// 환경변수 읽기 헬퍼
function getEnv(key: string, def: string): string {
  return (import.meta.env[key] as string) || def;
}

export const useAiConfigStore = create<AiConfigState & AiConfigActions>()(
  persist(
    (set) => {
      // 초기값 결정 로직
      const defaultProvider = (getEnv('VITE_AI_PROVIDER', 'mock') as AiProvider).toLowerCase() as AiProvider;
      const validProvider = ['openai', 'anthropic', 'mock'].includes(defaultProvider) ? defaultProvider : 'mock';

      // 환경변수 VITE_AI_MODEL이 있으면 그걸 우선으로 둘 다 설정, 없으면 Provider별 기본값
      const envModel = getEnv('VITE_AI_MODEL', '');
      
      let defaultTranslationModel = envModel;
      let defaultChatModel = envModel;

      if (!envModel) {
        if (validProvider === 'anthropic') {
          defaultTranslationModel = 'claude-3-5-sonnet-latest';
          defaultChatModel = 'claude-3-5-haiku-latest';
        } else {
          // openai or mock
          defaultTranslationModel = 'gpt-5.2';
          defaultChatModel = 'gpt-5-mini';
        }
      }

      return {
        provider: validProvider,
        translationModel: defaultTranslationModel,
        chatModel: defaultChatModel,

        setProvider: (provider) => set({ provider }),
        setTranslationModel: (model) => set({ translationModel: model }),
        setChatModel: (model) => set({ chatModel: model }),
      };
    },
    {
      name: 'ite-ai-config',
    }
  )
);

