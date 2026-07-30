import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { getAiConfig, MODEL_BY_USE, normalizeProvider, resolveModelForUse } from '@/ai/config';

describe('getAiConfig - provider × 용도 매핑', () => {
  const originalOpenAi = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    useAiConfigStore.setState({
      provider: 'openai',
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
    expect(cfg.model).toBe('gpt-5.6-luna');
    expect(cfg.reasoningEffort).toBe('high');
    expect(cfg.openaiApiKey).toBe('env-openai-key');
  });

  // 이 매핑이 무너지면 폴리싱이 검수 모델로 실행되는 원래 문제가 되돌아온다.
  it('검수만 상위 모델로 해석되고 번역·폴리싱·채팅은 동일 모델', () => {
    useAiConfigStore.setState({ provider: 'anthropic' });

    expect(getAiConfig({ useFor: 'review' }).model).toBe('claude-opus-5');
    expect(getAiConfig({ useFor: 'translation' }).model).toBe('claude-sonnet-5');
    expect(getAiConfig({ useFor: 'polish' }).model).toBe('claude-sonnet-5');
    expect(getAiConfig({ useFor: 'chat' }).model).toBe('claude-sonnet-5');
  });

  it('effort는 요약만 medium이고 나머지는 전부 high', () => {
    useAiConfigStore.setState({ provider: 'anthropic' });

    expect(getAiConfig({ useFor: 'summary' }).reasoningEffort).toBe('medium');
    for (const useFor of ['translation', 'review', 'polish', 'chat'] as const) {
      expect(getAiConfig({ useFor }).reasoningEffort).toBe('high');
    }
  });

  it('OpenAI도 검수만 Sol이고 나머지는 Luna', () => {
    expect(resolveModelForUse('openai', 'review').model).toBe('gpt-5.6-sol');
    expect(resolveModelForUse('openai', 'translation').model).toBe('gpt-5.6-luna');
    expect(resolveModelForUse('openai', 'polish').model).toBe('gpt-5.6-luna');
    expect(resolveModelForUse('openai', 'summary')).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'medium',
    });
  });

  it('Haiku는 매핑에서 완전히 사라졌다', () => {
    const models = Object.values(MODEL_BY_USE).flatMap((byUse) =>
      Object.values(byUse).map((spec) => spec.model),
    );
    expect(models.some((m) => m.includes('haiku'))).toBe(false);
  });

  it('Store의 OpenAI 키가 있으면 환경변수보다 Store 값을 우선 사용', () => {
    useAiConfigStore.setState({ openaiApiKey: 'store-openai-key' });
    process.env.OPENAI_API_KEY = 'env-openai-key';

    const cfg = getAiConfig({ useFor: 'chat' });

    expect(cfg.openaiApiKey).toBe('store-openai-key');
  });

  it('Anthropic provider에서 Store 키가 없으면 ANTHROPIC_API_KEY를 fallback으로 사용', () => {
    useAiConfigStore.setState({ provider: 'anthropic', anthropicApiKey: undefined });
    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';

    const cfg = getAiConfig({ useFor: 'translation' });

    expect(cfg.provider).toBe('anthropic');
    expect(cfg.anthropicApiKey).toBe('env-anthropic-key');
  });

  it('dev 런타임에서도 Store 키가 없으면 env fallback을 사용한다', () => {
    // vitest는 import.meta.env.DEV=true 이므로 allowEnvApiKeyFallback이 켜진다.
    process.env.OPENAI_API_KEY = 'dev-openai-key';

    const cfg = getAiConfig({ useFor: 'chat' });

    expect(cfg.openaiApiKey).toBe('dev-openai-key');
  });
});

describe('normalizeProvider - 레거시 프리셋 ID 정규화', () => {
  it('provider 값은 그대로 통과', () => {
    expect(normalizeProvider('anthropic')).toBe('anthropic');
    expect(normalizeProvider('openai')).toBe('openai');
  });

  it('v13 이전 프리셋 ID를 provider로 환산', () => {
    expect(normalizeProvider('claude-sonnet-5')).toBe('anthropic');
    expect(normalizeProvider('claude-haiku-4-5')).toBe('anthropic');
    expect(normalizeProvider('gpt-5.6-sol-high')).toBe('openai');
    expect(normalizeProvider('gpt-5.6-luna-medium')).toBe('openai');
  });

  it('값이 없으면 null (호출부가 기본 provider로 채운다)', () => {
    expect(normalizeProvider(undefined)).toBeNull();
    expect(normalizeProvider(null)).toBeNull();
    expect(normalizeProvider('')).toBeNull();
  });
});
