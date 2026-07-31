import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import {
  buildSessionPin,
  getAiConfig,
  getModelSpecForUse,
  MODEL_BY_USE,
  normalizeProvider,
  normalizeSessionPin,
  pinnedChatSpec,
  resolveModelForUse,
  resolveModelRunConfig,
} from '@/ai/config';

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
    expect(resolveModelForUse('openai', 'review').model).toBe('gpt-5.6-terra');
    expect(resolveModelForUse('openai', 'translation').model).toBe('gpt-5.6-luna');
    expect(resolveModelForUse('openai', 'polish').model).toBe('gpt-5.6-luna');
    expect(resolveModelForUse('openai', 'summary')).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'medium',
    });
  });

  // ADR-0017 이후 Haiku는 사용자가 고를 수는 있다(MODEL_CHOICES). 기본 매핑에만 없다.
  it('Haiku는 기본 매핑에 없다', () => {
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

describe('모델 직접 지정 (ADR-0017)', () => {
  it('지정한 칸만 갈아끼우고 나머지는 기본값을 유지한다', () => {
    const overrides = { anthropic: { review: { model: 'claude-sonnet-5' } } };

    expect(resolveModelForUse('anthropic', 'review', overrides).model).toBe('claude-sonnet-5');
    expect(resolveModelForUse('anthropic', 'translation', overrides).model).toBe('claude-sonnet-5');
    expect(resolveModelForUse('anthropic', 'polish', overrides).model).toBe('claude-sonnet-5');
    // 다른 provider는 영향을 받지 않는다.
    expect(resolveModelForUse('openai', 'review', overrides).model).toBe('gpt-5.6-terra');
  });

  it('모델만 지정하면 effort는 기본값을 유지한다', () => {
    const overrides = { anthropic: { polish: { model: 'claude-haiku-4-5' } } };
    expect(resolveModelForUse('anthropic', 'polish', overrides)).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'high',
    });
  });

  it('effort만 지정하면 모델은 기본값을 유지한다', () => {
    const overrides = { anthropic: { polish: { effort: 'medium' as const } } };
    expect(resolveModelForUse('anthropic', 'polish', overrides)).toEqual({
      model: 'claude-sonnet-5',
      effort: 'medium',
    });
  });

  it('모델과 effort는 서로 독립적으로 지정된다', () => {
    const overrides = {
      anthropic: { review: { model: 'claude-sonnet-5', effort: 'medium' as const } },
    };
    expect(resolveModelForUse('anthropic', 'review', overrides)).toEqual({
      model: 'claude-sonnet-5',
      effort: 'medium',
    });
  });

  it('목록에 없는 effort는 무시하고 기본값으로 떨어진다', () => {
    // xhigh/max는 의도적으로 제외했다 — maxTokens 예산이 high 기준이라 마커가 잘린다.
    const overrides = { anthropic: { review: { effort: 'xhigh' as never } } };
    expect(resolveModelForUse('anthropic', 'review', overrides).effort).toBe('high');
  });

  it('목록에 없는 모델은 무시하고 기본값으로 떨어진다', () => {
    // localStorage가 손으로 고쳐지거나 모델이 목록에서 빠진 경우. 모르는 모델로 튀지 않는다.
    const overrides = { anthropic: { review: { model: 'claude-opus-4-1' } } };
    expect(resolveModelForUse('anthropic', 'review', overrides).model).toBe('claude-opus-5');
  });

  it('provider가 엇갈린 지정은 적용되지 않는다', () => {
    const overrides = { anthropic: { review: { model: 'gpt-5.6-luna' } } };
    expect(resolveModelForUse('anthropic', 'review', overrides).model).toBe('claude-opus-5');
  });
});

describe('세션 pin — 채팅 모델 스냅샷', () => {
  it('지정이 없으면 provider만 담는다(기존 형식 그대로)', () => {
    expect(buildSessionPin('anthropic', {})).toBe('anthropic');
    expect(buildSessionPin('anthropic', { anthropic: { review: { model: 'claude-sonnet-5' } } })).toBe(
      'anthropic',
    );
  });

  it('채팅 지정이 있으면 모델까지 굳힌다', () => {
    const pin = buildSessionPin('anthropic', { anthropic: { chat: { model: 'claude-haiku-4-5' } } });
    expect(pin).toBe('anthropic#claude-haiku-4-5');
    expect(normalizeProvider(pin)).toBe('anthropic');
    expect(pinnedChatSpec(pin)).toEqual({ model: 'claude-haiku-4-5', effort: null });
  });

  it('정규화가 모델 스냅샷을 깎아내지 않는다', () => {
    // 깎으면 진행 중 대화가 다음 실행에서 현재 설정의 모델로 갈아탄다.
    expect(normalizeSessionPin('anthropic#claude-haiku-4-5', 'openai')).toBe(
      'anthropic#claude-haiku-4-5',
    );
  });

  it('레거시 pin과 빈 값은 provider로 정규화된다', () => {
    expect(normalizeSessionPin('claude-sonnet-5', 'openai')).toBe('anthropic');
    expect(normalizeSessionPin(undefined, 'openai')).toBe('openai');
  });

  it('목록에 없는 스냅샷은 버리고 provider만 남긴다', () => {
    expect(pinnedChatSpec('anthropic#claude-opus-4-1')).toEqual({ model: null, effort: null });
    expect(normalizeSessionPin('anthropic#claude-opus-4-1', 'openai')).toBe('anthropic');
  });
});

describe('resolveModelRunConfig — 세션 pin이 채팅 모델의 권위다 (회귀)', () => {
  beforeEach(() => {
    useAiConfigStore.setState({
      provider: 'anthropic',
      modelOverrides: { anthropic: { chat: { model: 'claude-haiku-4-5' } } },
    });
  });

  it('스냅샷 없는 pin은 현재 지정이 아니라 기본값으로 간다', () => {
    // 지정을 켜기 전에 만들어진 세션이 다음 턴에 모델을 갈아타면, 스냅샷으로 막으려던
    // 캐시 프리픽스 파기가 그대로 일어난다.
    expect(resolveModelRunConfig({ provider: 'anthropic' }).resolvedModel).toBe('claude-sonnet-5');
  });

  it('스냅샷이 있으면 그 모델을 쓴다', () => {
    expect(resolveModelRunConfig({ provider: 'anthropic#claude-haiku-4-5' }).resolvedModel).toBe(
      'claude-haiku-4-5',
    );
  });

  it('지정을 바꿔도 이미 스냅샷된 세션은 흔들리지 않는다', () => {
    useAiConfigStore.setState({ modelOverrides: { anthropic: { chat: { model: 'claude-opus-5' } } } });
    expect(resolveModelRunConfig({ provider: 'anthropic#claude-haiku-4-5' }).resolvedModel).toBe(
      'claude-haiku-4-5',
    );
  });

  it('pin이 없는 호출(비채팅 포함)은 현재 지정을 따른다', () => {
    useAiConfigStore.setState({
      modelOverrides: { anthropic: { chat: { model: 'claude-haiku-4-5' }, review: { model: 'claude-sonnet-5' } } },
    });
    expect(resolveModelRunConfig().resolvedModel).toBe('claude-haiku-4-5');
    expect(resolveModelRunConfig({ useFor: 'review' }).resolvedModel).toBe('claude-sonnet-5');
    // 검수는 세션 개념이 없으므로 pin 문자열이 와도 지정이 살아 있어야 한다.
    expect(resolveModelRunConfig({ provider: 'anthropic', useFor: 'review' }).resolvedModel).toBe(
      'claude-sonnet-5',
    );
  });
});

describe('요약 모델 지정 반영 (회귀)', () => {
  it('getModelSpecForUse가 저장된 지정을 읽는다', () => {
    // resolveModelForUse는 지정을 인자로 받는 순수 함수라, 스토어 읽기를 잊으면 조용히 무시된다.
    useAiConfigStore.setState({
      provider: 'anthropic',
      modelOverrides: { anthropic: { summary: { model: 'claude-haiku-4-5' } } },
    });
    expect(getModelSpecForUse('anthropic', 'summary')).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'medium',
    });
  });
});

describe('세션 pin — effort 스냅샷', () => {
  it('effort만 지정하면 모델 구간을 비워 둔다', () => {
    const pin = buildSessionPin('anthropic', { anthropic: { chat: { effort: 'medium' } } });
    expect(pin).toBe('anthropic##medium');
    expect(normalizeProvider(pin)).toBe('anthropic');
    expect(pinnedChatSpec(pin)).toEqual({ model: null, effort: 'medium' });
  });

  it('둘 다 지정하면 둘 다 굳힌다', () => {
    const pin = buildSessionPin('anthropic', {
      anthropic: { chat: { model: 'claude-haiku-4-5', effort: 'medium' } },
    });
    expect(pin).toBe('anthropic#claude-haiku-4-5#medium');
    expect(pinnedChatSpec(pin)).toEqual({ model: 'claude-haiku-4-5', effort: 'medium' });
  });

  it('정규화가 effort 스냅샷도 깎아내지 않는다', () => {
    expect(normalizeSessionPin('anthropic##medium', 'openai')).toBe('anthropic##medium');
    expect(normalizeSessionPin('anthropic#claude-haiku-4-5#medium', 'openai')).toBe(
      'anthropic#claude-haiku-4-5#medium',
    );
  });

  it('스냅샷된 effort는 현재 지정이 바뀌어도 흔들리지 않는다', () => {
    useAiConfigStore.setState({
      provider: 'anthropic',
      modelOverrides: { anthropic: { chat: { effort: 'high' } } },
    });
    expect(resolveModelRunConfig({ provider: 'anthropic##medium' }).reasoningEffort).toBe('medium');
  });
});
