import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import {
  approxTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  computeInputBudget,
  SUMMARY_TRIGGER_RATIO,
} from './tokenBudget';

describe('approxTokens', () => {
  it('빈 문자열은 0 토큰', () => {
    expect(approxTokens('')).toBe(0);
    expect(approxTokens('   ')).toBe(0);
  });

  it('라틴 텍스트는 대략 문자수/4 수준으로 추정', () => {
    const t = approxTokens('hello world this is a test sentence');
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(20);
  });

  it('한국어는 같은 글자 수의 라틴보다 토큰 비중이 높다', () => {
    const ko = approxTokens('가나다라마바사아자차');
    const en = approxTokens('abcdefghij');
    expect(ko).toBeGreaterThan(en);
  });

  it('길이에 대해 단조 증가', () => {
    expect(approxTokens('a'.repeat(400))).toBeGreaterThan(approxTokens('a'.repeat(40)));
  });
});

describe('estimateMessageTokens', () => {
  it('이미지 블록은 텍스트만 있는 메시지보다 큰 비용', () => {
    const textOnly = new HumanMessage('describe this image');
    const withImage = new HumanMessage({
      content: [
        { type: 'text', text: 'describe this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    });
    expect(estimateMessageTokens(withImage)).toBeGreaterThan(estimateMessageTokens(textOnly));
  });

  it('estimateMessagesTokens는 각 메시지 추정의 합 이상', () => {
    const msgs = [new HumanMessage('one'), new HumanMessage('two')];
    const total = estimateMessagesTokens(msgs);
    expect(total).toBeGreaterThanOrEqual(
      estimateMessageTokens(msgs[0]!) + estimateMessageTokens(msgs[1]!),
    );
  });
});

describe('computeInputBudget', () => {
  it('usable = max - output - reserve, 요약 트리거는 usable의 비율', () => {
    const b = computeInputBudget({ maxInputTokens: 200_000, outputTokenBudget: 8_000 });
    expect(b.usableInputTokens).toBeLessThan(200_000 - 8_000);
    expect(b.usableInputTokens).toBeGreaterThan(0);
    expect(b.summaryTriggerTokens).toBeCloseTo(b.usableInputTokens * SUMMARY_TRIGGER_RATIO, -1);
  });

  it('output+reserve가 max를 초과해도 usable은 음수가 아니다', () => {
    const b = computeInputBudget({ maxInputTokens: 1_000, outputTokenBudget: 5_000 });
    expect(b.usableInputTokens).toBeGreaterThanOrEqual(0);
    expect(b.summaryTriggerTokens).toBeGreaterThanOrEqual(0);
  });
});
