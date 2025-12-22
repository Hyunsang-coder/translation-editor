import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAiConfig } from '@/ai/config';

export function createChatModel(modelOverride?: string): BaseChatModel {
  const cfg = getAiConfig();
  const model = modelOverride ?? cfg.model;

  if (cfg.provider === 'openai') {
    if (!cfg.openaiApiKey) {
      throw new Error('OPENAI API key is missing (VITE_OPENAI_API_KEY).');
    }
    return new ChatOpenAI({
      apiKey: cfg.openaiApiKey,
      model,
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    });
  }

  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error('Anthropic API key is missing (VITE_ANTHROPIC_API_KEY).');
    }
    return new ChatAnthropic({
      apiKey: cfg.anthropicApiKey,
      model,
      ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    });
  }

  throw new Error('AI provider is set to mock.');
}


