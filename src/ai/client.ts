import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAiConfig, isLocalEndpoint } from '@/ai/config';
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
    const isLocal = isLocalEndpoint(cfg.openaiBaseUrl);

    // 로컬 엔드포인트면 API 키 없이도 허용 (Ollama는 아무 값이나 가능)
    if (!isLocal && !cfg.openaiApiKey) {
      throw new Error(i18n.t('errors.openaiApiKeyMissing'));
    }

    // GPT-5.2, GPT-5-mini 등 최신 모델은 temperature 파라미터를 지원하지 않거나 무시해야 함
    const isGpt5 = model.startsWith('gpt-5');
    const temperatureOption = isGpt5 ? {} : (cfg.temperature !== undefined ? { temperature: cfg.temperature } : {});

    // 번역 모드에서는 max_tokens를 높게 설정하여 긴 문서도 완전히 번역되도록 함
    // 로컬 LLM은 보수적인 기본값 사용
    // options.maxTokens가 명시적으로 전달되면 해당 값 사용
    let defaultMaxTokens: number | undefined;
    if (useFor === 'translation') {
      if (isLocal) {
        defaultMaxTokens = cfg.maxOutputTokens ?? 4096;
      } else if (isGpt5) {
        defaultMaxTokens = 65536;
      } else {
        defaultMaxTokens = 16384;
      }
    } else if (isLocal) {
      defaultMaxTokens = cfg.maxOutputTokens ?? 4096;
    }

    const maxTokensOption = options?.maxTokens
      ? { maxTokens: options.maxTokens }
      : (defaultMaxTokens ? { maxTokens: defaultMaxTokens } : {});

    // Responses API는 로컬 엔드포인트에서 지원하지 않음
    const useResponsesApi = useFor === 'chat' && !isLocal;

    return new ChatOpenAI({
      apiKey: isLocal ? (cfg.openaiApiKey || 'ollama') : cfg.openaiApiKey,
      model,
      // 로컬 엔드포인트 설정
      ...(cfg.openaiBaseUrl ? { configuration: { baseURL: cfg.openaiBaseUrl } } : {}),
      ...temperatureOption,
      ...maxTokensOption,
      // OpenAI built-in tools(web/file search 등) 사용을 위해 chat 용도에서는 Responses API를 우선 사용
      // 로컬 엔드포인트는 Responses API 미지원
      ...(useResponsesApi ? { useResponsesApi: true } : {}),
    });
  }

  throw new Error(i18n.t('errors.unsupportedProvider', { provider: cfg.provider }));
}
