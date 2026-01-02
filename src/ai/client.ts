import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAiConfig } from '@/ai/config';

export function createChatModel(
  modelOverride?: string,
  options?: { useFor?: 'translation' | 'chat' }
): BaseChatModel {
  const cfg = getAiConfig(options);
  const model = modelOverride ?? cfg.model;
  const useFor = options?.useFor ?? 'chat';

  if (cfg.provider === 'openai') {
    if (!cfg.openaiApiKey) {
      throw new Error('OpenAI API key is missing. Please enter it in App Settings.');
    }

    // GPT-5.2, GPT-5-mini 등 최신 모델은 temperature 파라미터를 지원하지 않거나 무시해야 함
    // (o1, o3 등도 유사할 수 있으나 여기서는 명시된 gpt-5 계열만 처리)
    const isGpt5 = model.startsWith('gpt-5');
    const temperatureOption = isGpt5 ? {} : (cfg.temperature !== undefined ? { temperature: cfg.temperature } : {});
    
    // 번역 모드에서는 max_tokens를 높게 설정하여 긴 문서도 완전히 번역되도록 함
    const maxTokensOption = useFor === 'translation' ? { maxTokens: 16384 } : {};

    return new ChatOpenAI({
      apiKey: cfg.openaiApiKey,
      model,
      ...temperatureOption,
      ...maxTokensOption,
      // OpenAI built-in tools(web/file search 등) 사용을 위해 chat 용도에서는 Responses API를 우선 사용
      ...(useFor === 'chat' ? { useResponsesApi: true } : {}),
    });
  }

  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error('Anthropic API key is missing. Please enter it in App Settings.');
    }
    // 번역 모드에서는 max_tokens를 높게 설정
    const maxTokensOption = useFor === 'translation' ? { maxTokens: 16384 } : {};
    return new ChatAnthropic({
      apiKey: cfg.anthropicApiKey,
      model,
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
      ...maxTokensOption,
    });
  }

  if (cfg.provider === 'google') {
    if (!cfg.googleApiKey) {
      throw new Error('Google API key is missing. Please enter it in App Settings.');
    }
    // 번역 모드에서는 max_tokens를 높게 설정
    const maxTokensOption = useFor === 'translation' ? { maxOutputTokens: 16384 } : {};
    return new ChatGoogleGenerativeAI({
      apiKey: cfg.googleApiKey,
      model,
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
      ...maxTokensOption,
    });
  }

  throw new Error(`Unsupported AI provider: ${cfg.provider}. Please select a valid provider in App Settings.`);
}
