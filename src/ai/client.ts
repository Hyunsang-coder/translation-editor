import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAiConfig } from '@/ai/config';

export function createChatModel(
  modelOverride?: string,
  options?: { useFor?: 'translation' | 'chat' }
): BaseChatModel {
  const cfg = getAiConfig(options);
  const model = modelOverride ?? cfg.model;

  if (cfg.provider === 'openai') {
    if (!cfg.openaiApiKey) {
      throw new Error('OpenAI API key is missing. Please set VITE_OPENAI_API_KEY environment variable or enter it in App Settings.');
    }

    // GPT-5.2, GPT-5-mini 등 최신 모델은 temperature 파라미터를 지원하지 않거나 무시해야 함
    // (o1, o3 등도 유사할 수 있으나 여기서는 명시된 gpt-5 계열만 처리)
    const isGpt5 = model.startsWith('gpt-5');
    const temperatureOption = isGpt5 ? {} : (cfg.temperature !== undefined ? { temperature: cfg.temperature } : {});

    return new ChatOpenAI({
      apiKey: cfg.openaiApiKey,
      model,
      ...temperatureOption,
    });
  }

  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error('Anthropic API key is missing. Please set VITE_ANTHROPIC_API_KEY environment variable or enter it in App Settings.');
    }
    return new ChatAnthropic({
      apiKey: cfg.anthropicApiKey,
      model,
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    });
  }

  throw new Error(`Unsupported AI provider: ${cfg.provider}. Please select a valid provider in App Settings.`);
}
