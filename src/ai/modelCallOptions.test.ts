import { describe, expect, it } from 'vitest';
import type { AiConfig } from '@/ai/config';
import { resolveModelCallOptions } from './modelCallOptions';

function cfg(partial: Partial<AiConfig> & Pick<AiConfig, 'provider' | 'model'>): AiConfig {
  return { maxRecentMessages: 20, ...partial };
}

describe('resolveModelCallOptions', () => {
  it('Opus 4.7+ → adaptiveThinking + 매핑 effort, temperature 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-opus-4-7', temperature: 0.5, reasoningEffort: 'high' }),
    );
    expect(opts.adaptiveThinking).toBe(true);
    expect(opts.effort).toBe('high');
    expect(opts.temperature).toBeUndefined();
  });

  it('Opus 5 → adaptiveThinking + effort high, temperature 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-opus-5', temperature: 0.5, reasoningEffort: 'high' }),
    );
    expect(opts.adaptiveThinking).toBe(true);
    expect(opts.effort).toBe('high');
    expect(opts.temperature).toBeUndefined();
  });

  // 프리셋 시절에는 Sonnet 5가 review일 때만 effort를 받았다. 이제는 용도와 무관하게
  // 매핑이 준 값을 그대로 보낸다(기본값이 바뀌어도 흔들리지 않게 명시 전송).
  it('Sonnet 5는 용도와 무관하게 매핑 effort를 그대로 전달', () => {
    const high = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-sonnet-5', temperature: 0.5, reasoningEffort: 'high' }),
    );
    expect(high.adaptiveThinking).toBe(true);
    expect(high.effort).toBe('high');
    expect(high.temperature).toBeUndefined();

    const medium = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'medium' }),
    );
    expect(medium.effort).toBe('medium');
  });

  it('gpt-5 계열 → 매핑 effort 전달, temperature 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'openai', model: 'gpt-5.6-sol', temperature: 0.7, reasoningEffort: 'high' }),
    );
    expect(opts.effort).toBe('high');
    expect(opts.temperature).toBeUndefined();
  });

  it('gpt-5 계열 medium도 그대로 전달', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'medium' }),
    );
    expect(opts.effort).toBe('medium');
  });

  it('구형 Claude → effort 미전달, temperature 유지', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-sonnet-4-6', temperature: 0.4, reasoningEffort: 'high' }),
    );
    expect(opts.temperature).toBe(0.4);
    expect(opts.adaptiveThinking).toBeUndefined();
    expect(opts.effort).toBeUndefined();
  });

  // A3: reasoning_effort는 gpt-5 계열만 지원하므로 비 gpt-5 모델에는 붙이지 않는다
  it('gpt-4o → effort 없음 (reasoning_effort 미지원 모델 가드), temperature 유지', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'openai', model: 'gpt-4o', temperature: 0.3, reasoningEffort: 'high' }),
    );
    expect(opts.effort).toBeUndefined();
    expect(opts.temperature).toBe(0.3);
  });

  it('mock provider, 비 gpt-5 모델 → effort 없음 (OpenAI fallback 경로)', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'mock', model: 'gpt-4o-mini', reasoningEffort: 'high' }),
    );
    expect(opts.effort).toBeUndefined();
  });

  it('effort가 없는 cfg에는 아무것도 붙이지 않는다', () => {
    const opts = resolveModelCallOptions(cfg({ provider: 'anthropic', model: 'claude-sonnet-5' }));
    expect(opts.adaptiveThinking).toBe(true);
    expect(opts.effort).toBeUndefined();
  });
});
