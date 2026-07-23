import { describe, it, expect } from 'vitest';
import type { ChatMessage, ChatSessionMemory } from '@/types';
import { planConversationContext } from './conversationContext';
import { computeInputBudget, MAX_RECENT_TURNS } from './tokenBudget';

function mkMessages(n: number, opts?: { longAt?: number; longChars?: number }): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    const isLong = opts?.longAt === i;
    out.push({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: isLong ? 'x'.repeat(opts?.longChars ?? 40_000) : `message ${i}`,
      timestamp: 1000 + i,
    });
  }
  return out;
}

const bigBudget = computeInputBudget({ maxInputTokens: 180_000, outputTokenBudget: 8_000 });

describe('planConversationContext', () => {
  it('100개 짧은 메시지: 오래된 구간은 요약 대상, 최근 턴만 원문 유지, 무손실', () => {
    const messages = mkMessages(100);
    const plan = planConversationContext({ messages, budget: bigBudget });

    expect(plan.needsSummary).toBe(true);
    expect(plan.recentRawMessages.length).toBeLessThanOrEqual(MAX_RECENT_TURNS * 2);
    expect(plan.recentRawMessages[0]!.role).toBe('user');
    // 초기 결정(m0)은 원문 윈도우가 아니라 요약 대상에 있어야 한다
    expect(plan.messagesToSummarize.some((m) => m.id === 'm0')).toBe(true);
    // 무손실: 요약대상 + 최근원문 = 전체
    expect(plan.messagesToSummarize.length + plan.recentRawMessages.length).toBe(100);
    // 마지막 요약 경계 id
    expect(plan.summarizedThroughMessageId).toBe(
      plan.messagesToSummarize[plan.messagesToSummarize.length - 1]!.id,
    );
  });

  it('짧은 대화는 요약 없이 전부 원문 유지', () => {
    const messages = mkMessages(6);
    const plan = planConversationContext({ messages, budget: bigBudget });
    expect(plan.needsSummary).toBe(false);
    expect(plan.messagesToSummarize).toHaveLength(0);
    expect(plan.recentRawMessages).toHaveLength(6);
  });

  it('매우 긴 단일 메시지는 token budget으로 원문 윈도우에서 밀려나 요약 대상이 된다', () => {
    const messages = mkMessages(30, { longAt: 10, longChars: 60_000 });
    const budget = computeInputBudget({ maxInputTokens: 20_000, outputTokenBudget: 500 });
    const plan = planConversationContext({ messages, budget });

    expect(plan.needsSummary).toBe(true);
    // 긴 메시지(m10)는 예산 초과로 원문에서 제외되어야 한다
    expect(plan.recentRawMessages.some((m) => m.id === 'm10')).toBe(false);
    expect(plan.messagesToSummarize.some((m) => m.id === 'm10')).toBe(true);
  });

  it('기존 summary 이후 구간만 증분 요약한다', () => {
    const messages = mkMessages(50);
    const memory: ChatSessionMemory = {
      summary: '앞선 30개 대화 요약',
      summarizedThroughMessageId: 'm29',
      summaryUpdatedAt: 1,
      summaryModel: 'claude-haiku-4-5',
      summaryVersion: 1,
    };
    const plan = planConversationContext({ messages, memory, budget: bigBudget });

    // 이미 요약된 m0~m29는 다시 요약 대상이 되면 안 된다
    for (let i = 0; i <= 29; i++) {
      expect(plan.messagesToSummarize.some((m) => m.id === `m${i}`)).toBe(false);
      expect(plan.recentRawMessages.some((m) => m.id === `m${i}`)).toBe(false);
    }
  });

  it('원문 윈도우는 항상 user 메시지부터 시작한다', () => {
    // 51개(홀수) → 자연스러운 last-24 윈도우가 assistant부터 시작할 수 있는 배치
    const messages = mkMessages(51);
    const plan = planConversationContext({ messages, budget: bigBudget });
    expect(plan.recentRawMessages[0]!.role).toBe('user');
  });

  it('작은 컨텍스트 예산일수록 원문 윈도우가 줄어든다 (재예산)', () => {
    const messages = mkMessages(40);
    const large = planConversationContext({
      messages,
      budget: computeInputBudget({ maxInputTokens: 180_000, outputTokenBudget: 8_000 }),
    });
    const small = planConversationContext({
      messages,
      budget: computeInputBudget({ maxInputTokens: 12_000, outputTokenBudget: 2_000 }),
      // 최근 원문을 강하게 제약하도록 큰 고정 컨텍스트 예약
      reservedContextTokens: 3_000,
    });
    expect(small.recentRawMessages.length).toBeLessThanOrEqual(large.recentRawMessages.length);
  });
});
