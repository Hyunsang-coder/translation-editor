import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { getAiConfig, MODEL_PRESETS } from '@/ai/config';

describe('getAiConfig - test env fallback', () => {
  const originalOpenAi = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    useAiConfigStore.setState({
      translationModel: 'gpt-5.6-sol-high',
      chatModel: 'gpt-5.6-sol-high',
      openaiApiKey: undefined,
      anthropicApiKey: undefined,
      openaiEnabled: true,
      anthropicEnabled: false,
    });

    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAi === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAi;
    }

    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });

  it('테스트 환경에서 Store 키가 없으면 OPENAI_API_KEY를 fallback으로 사용', () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';

    const cfg = getAiConfig({ useFor: 'chat' });

    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('gpt-5.6-sol');
    expect(cfg.reasoningEffort).toBe('high');
    expect(cfg.openaiApiKey).toBe('env-openai-key');
  });

  it('GPT-5.6 Luna medium 선택을 API 모델 ID와 reasoning effort로 분리', () => {
    useAiConfigStore.setState({ chatModel: 'gpt-5.6-luna-medium' });

    const cfg = getAiConfig({ useFor: 'chat' });

    expect(cfg.model).toBe('gpt-5.6-luna');
    expect(cfg.reasoningEffort).toBe('medium');
  });

  it('OpenAI 프리셋은 요청된 GPT-5.6 세 조합만 제공', () => {
    expect(MODEL_PRESETS.openai.map(({ value }) => value)).toEqual([
      'gpt-5.6-sol-high',
      'gpt-5.6-luna-high',
      'gpt-5.6-luna-medium',
    ]);
  });

  it('Store의 OpenAI 키가 있으면 환경변수보다 Store 값을 우선 사용', () => {
    useAiConfigStore.setState({ openaiApiKey: 'store-openai-key' });
    process.env.OPENAI_API_KEY = 'env-openai-key';

    const cfg = getAiConfig({ useFor: 'chat' });

    expect(cfg.openaiApiKey).toBe('store-openai-key');
  });

  it('Claude 모델 선택 시 Store 키가 없으면 ANTHROPIC_API_KEY를 fallback으로 사용', () => {
    useAiConfigStore.setState({
      translationModel: 'claude-sonnet-4-6',
      anthropicApiKey: undefined,
    });
    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';

    const cfg = getAiConfig({ useFor: 'translation' });

    expect(cfg.provider).toBe('anthropic');
    expect(cfg.anthropicApiKey).toBe('env-anthropic-key');
  });
});
