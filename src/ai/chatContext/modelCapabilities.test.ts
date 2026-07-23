import { describe, it, expect } from 'vitest';
import { resolveModelCapabilities } from './modelCapabilities';

describe('resolveModelCapabilities', () => {
  it('anthropic 모델은 ~200k 컨텍스트 기반 입력 예산과 tool/vision 지원', () => {
    const c = resolveModelCapabilities({ resolvedModel: 'claude-sonnet-5', provider: 'anthropic' });
    expect(c.maxInputTokens).toBeGreaterThan(100_000);
    expect(c.maxInputTokens).toBeLessThanOrEqual(200_000);
    expect(c.toolCalling).toBe(true);
    expect(c.imageInputs).toBe(true);
    expect(c.builtInWebSearch).toBe(true);
  });

  it('openai 모델은 anthropic보다 큰 입력 예산', () => {
    const oa = resolveModelCapabilities({ resolvedModel: 'gpt-5.6-sol', provider: 'openai' });
    const an = resolveModelCapabilities({ resolvedModel: 'claude-sonnet-5', provider: 'anthropic' });
    expect(oa.maxInputTokens).toBeGreaterThan(an.maxInputTokens);
    expect(oa.toolCalling).toBe(true);
    expect(oa.imageInputs).toBe(true);
  });

  it('알 수 없는 모델은 provider 기본값으로 폴백', () => {
    const c = resolveModelCapabilities({ resolvedModel: 'some-future-model', provider: 'anthropic' });
    expect(c.maxInputTokens).toBeGreaterThan(0);
    expect(c.toolCalling).toBe(true);
  });

  it('mock provider는 안전한(0 초과) 기본값을 반환', () => {
    const c = resolveModelCapabilities({ resolvedModel: 'mock', provider: 'mock' });
    expect(c.maxInputTokens).toBeGreaterThan(0);
  });
});
