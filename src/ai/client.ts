import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAiConfig } from '@/ai/config';
import i18n from '@/i18n/config';

/**
 * Chat 모델 생성
 * - Provider: OpenAI, Anthropic 지원
 * - mock 모드는 개발용으로 유지 (OpenAI 모델로 fallback)
 */
export function createChatModel(
  modelOverride?: string,
  options?: { useFor?: 'translation' | 'chat'; maxTokens?: number }
): BaseChatModel {
  const cfg = getAiConfig(options);
  const model = modelOverride ?? cfg.model;
  const useFor = options?.useFor ?? 'chat';

  // Anthropic (Claude)
  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error(i18n.t('errors.anthropicApiKeyMissing'));
    }

    // Claude는 temperature 정상 지원 (0-1)
    const temperatureOption = cfg.temperature !== undefined
      ? { temperature: cfg.temperature } : {};

    // Claude는 max_tokens 기본값이 낮으므로 명시적 설정
    // Anthropic 출력 토큰 제한: 8192 (번역), 4096 (채팅)
    const maxTokensOption = options?.maxTokens
      ? { maxTokens: options.maxTokens }
      : (useFor === 'translation' ? { maxTokens: 8192 } : { maxTokens: 4096 });

    return new ChatAnthropic({
      apiKey: cfg.anthropicApiKey,
      model,
      ...temperatureOption,
      ...maxTokensOption,
    });
  }

  // OpenAI (또는 mock → OpenAI fallback)
  if (cfg.provider === 'openai' || cfg.provider === 'mock') {
    if (!cfg.openaiApiKey) {
      throw new Error(i18n.t('errors.openaiApiKeyMissing'));
    }

    // GPT-5.2, GPT-5-mini 등 최신 모델은 temperature 파라미터를 지원하지 않거나 무시해야 함
    const isGpt5 = model.startsWith('gpt-5');
    const temperatureOption = isGpt5 ? {} : (cfg.temperature !== undefined ? { temperature: cfg.temperature } : {});

    // 번역 모드에서는 max_tokens를 높게 설정하여 긴 문서도 완전히 번역되도록 함
    // GPT-5 시리즈는 400k 컨텍스트 윈도우 지원, 출력 토큰도 충분히 확보
    // options.maxTokens가 명시적으로 전달되면 해당 값 사용
    const maxTokensOption = options?.maxTokens
      ? { maxTokens: options.maxTokens }
      : (useFor === 'translation' ? { maxTokens: 65536 } : {});

    return new ChatOpenAI({
      apiKey: cfg.openaiApiKey,
      model,
      ...temperatureOption,
      ...maxTokensOption,
      // OpenAI built-in tools(web/file search 등) 사용을 위해 chat 용도에서는 Responses API를 우선 사용
      ...(useFor === 'chat' ? { useResponsesApi: true } : {}),
    });
  }

  throw new Error(i18n.t('errors.unsupportedProvider', { provider: cfg.provider }));
}
