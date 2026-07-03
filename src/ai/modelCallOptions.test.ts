import { describe, expect, it } from 'vitest';
import type { AiConfig } from '@/ai/config';
import { resolveModelCallOptions } from './modelCallOptions';

function cfg(partial: Partial<AiConfig> & Pick<AiConfig, 'provider' | 'model'>): AiConfig {
  return { maxRecentMessages: 20, ...partial };
}

describe('resolveModelCallOptions', () => {
  it('Opus 4.7+ review → adaptiveThinking + effort high, temperature 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-opus-4-7', temperature: 0.5 }),
      'review',
    );
    expect(opts.adaptiveThinking).toBe(true);
    expect(opts.effort).toBe('high');
    expect(opts.temperature).toBeUndefined();
  });

  it('Sonnet 5 chat → adaptiveThinking, effort 없음, temperature 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-sonnet-5', temperature: 0.5 }),
      'chat',
    );
    expect(opts.adaptiveThinking).toBe(true);
    expect(opts.effort).toBeUndefined();
    expect(opts.temperature).toBeUndefined();
  });

  it('Sonnet 5 review → effort high', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'review',
    );
    expect(opts.adaptiveThinking).toBe(true);
    expect(opts.effort).toBe('high');
  });

  it('gpt-5.5 review → effort high, temperature 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'openai', model: 'gpt-5.5', temperature: 0.7 }),
      'review',
    );
    expect(opts.effort).toBe('high');
    expect(opts.temperature).toBeUndefined();
  });

  it('gpt-5.5 chat → 옵션 없음', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'openai', model: 'gpt-5.5', temperature: 0.7 }),
      'chat',
    );
    expect(opts.effort).toBeUndefined();
    expect(opts.temperature).toBeUndefined();
    expect(opts.adaptiveThinking).toBeUndefined();
  });

  it('구형 Claude chat → temperature 유지', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'anthropic', model: 'claude-sonnet-4-6', temperature: 0.4 }),
      'chat',
    );
    expect(opts.temperature).toBe(0.4);
    expect(opts.adaptiveThinking).toBeUndefined();
    expect(opts.effort).toBeUndefined();
  });

  it('구형 OpenAI chat → temperature 유지', () => {
    const opts = resolveModelCallOptions(
      cfg({ provider: 'openai', model: 'gpt-4o', temperature: 0.3 }),
      'chat',
    );
    expect(opts.temperature).toBe(0.3);
    expect(opts.effort).toBeUndefined();
  });
});
