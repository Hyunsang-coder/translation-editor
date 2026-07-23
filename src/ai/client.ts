import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAiConfig, type ModelRunConfig } from '@/ai/config';
import { DEFAULT_TRANSLATION_MAX_TOKENS, DEFAULT_CHAT_MAX_TOKENS } from '@/ai/constants';
import { resolveModelCallOptions } from '@/ai/modelCallOptions';
import i18n from '@/i18n/config';
import { isTauriRuntime } from '@/tauri/invoke';
import { getTauriResilientFetch } from '@/ai/tauriFetch';

/**
 * Chat 모델 생성
 * - Provider: OpenAI, Anthropic 지원
 * - mock 모드는 개발용으로 유지 (OpenAI 모델로 fallback)
 */
export function createChatModel(
  modelOverride?: string,
  options?: {
    useFor?: 'translation' | 'chat' | 'review';
    maxTokens?: number;
    /**
     * 요청 시작 시 캡처한 불변 실행 설정.
     * 전달되면 전역 store를 다시 읽지 않고 이 설정으로 모델을 만든다(경쟁 조건 제거).
     */
    runConfig?: ModelRunConfig;
  }
): BaseChatModel {
  const rc = options?.runConfig;
  // runConfig가 있으면 그 스냅샷을 사용하고, 없으면 기존처럼 전역 store를 읽는다(번역/검수/폴리싱 호환).
  const cfg = rc
    ? {
        provider: rc.provider,
        model: rc.resolvedModel,
        ...(rc.reasoningEffort ? { reasoningEffort: rc.reasoningEffort } : {}),
        ...(rc.temperature !== undefined ? { temperature: rc.temperature } : {}),
        ...(rc.openaiApiKey ? { openaiApiKey: rc.openaiApiKey } : {}),
        ...(rc.anthropicApiKey ? { anthropicApiKey: rc.anthropicApiKey } : {}),
        maxRecentMessages: rc.maxRecentMessages,
      }
    : getAiConfig(options);
  const model = rc ? rc.resolvedModel : (modelOverride ?? cfg.model);
  const useFor = options?.useFor ?? 'chat';
  const isReview = useFor === 'review';

  // Tauri 런타임에서는 WebView fetch 실패 시 백엔드(reqwest)로 우회하는 fetch를 주입한다.
  // 정상 환경에서는 네이티브 fetch를 그대로 사용하므로 동작 변화가 없다.
  const useTauriFetch = isTauriRuntime();
  const tauriFetch = useTauriFetch ? getTauriResilientFetch() : undefined;

  // 모델별 호출 옵션(temperature/thinking/effort)은 modelCallOptions에서 일괄 결정.
  // modelOverride가 있으면 그 모델 기준으로 판정해야 하므로 model을 덮어써 전달한다.
  // 모델 지원 여부 가드(예: reasoning_effort는 gpt-5 계열만)는 전부 resolveModelCallOptions에
  // 있으므로, 이 파일은 반환된 옵션을 판정 없이 그대로 전달한다. (A3)
  const callOptions = resolveModelCallOptions({ ...cfg, model }, useFor);

  // Anthropic (Claude)
  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error(i18n.t('errors.anthropicApiKeyMissing'));
    }

    // Claude는 max_tokens 기본값이 낮으므로 명시적 설정 (review는 번역과 동일 취급)
    const maxTokensOption = options?.maxTokens
      ? { maxTokens: options.maxTokens }
      : ((useFor === 'translation' || isReview) ? { maxTokens: DEFAULT_TRANSLATION_MAX_TOKENS } : { maxTokens: DEFAULT_CHAT_MAX_TOKENS });

    return new ChatAnthropic({
      apiKey: cfg.anthropicApiKey,
      model,
      ...(callOptions.temperature !== undefined ? { temperature: callOptions.temperature } : {}),
      ...maxTokensOption,
      ...(callOptions.adaptiveThinking ? { thinking: { type: 'adaptive' as const } } : {}),
      ...(callOptions.effort ? { outputConfig: { effort: callOptions.effort } } : {}),
      ...(tauriFetch
        ? { clientOptions: { fetch: tauriFetch, dangerouslyAllowBrowser: true } }
        : {}),
    });
  }

  // OpenAI (또는 mock → OpenAI fallback)
  if (cfg.provider === 'openai' || cfg.provider === 'mock') {
    if (!cfg.openaiApiKey) {
      throw new Error(i18n.t('errors.openaiApiKeyMissing'));
    }

    // 번역 모드에서는 max_tokens를 높게 설정하여 긴 문서도 완전히 번역되도록 함
    // GPT-5 시리즈는 400k 컨텍스트 윈도우 지원, 출력 토큰도 충분히 확보
    // options.maxTokens가 명시적으로 전달되면 해당 값 사용 (review는 번역과 동일 취급)
    const maxTokensOption = options?.maxTokens
      ? { maxTokens: options.maxTokens }
      : ((useFor === 'translation' || isReview) ? { maxTokens: 65536 } : {});

    return new ChatOpenAI({
      apiKey: cfg.openaiApiKey,
      model,
      ...(callOptions.temperature !== undefined ? { temperature: callOptions.temperature } : {}),
      ...maxTokensOption,
      ...(callOptions.effort ? { reasoning: { effort: callOptions.effort } } : {}),
      // OpenAI built-in tools(web/file search 등) 사용을 위해 chat 용도에서는 Responses API를 우선 사용
      ...(useFor === 'chat' ? { useResponsesApi: true } : {}),
      ...(tauriFetch
        ? { configuration: { fetch: tauriFetch, dangerouslyAllowBrowser: true } }
        : {}),
    });
  }

  throw new Error(i18n.t('errors.unsupportedProvider', { provider: cfg.provider }));
}
