import { describe, it, expect } from 'vitest';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { withAnthropicPromptCache } from './anthropicPromptCache';

type Block = { type?: string; text?: string; cache_control?: unknown };

function cacheMarkerCount(messages: BaseMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content as Block[]) {
      if (block && typeof block === 'object' && 'cache_control' in block) count++;
    }
  }
  return count;
}

describe('withAnthropicPromptCache', () => {
  it('시스템 메시지와 마지막 HumanMessage에 breakpoint를 추가한다', () => {
    const messages = [
      new SystemMessage('시스템 프롬프트'),
      new HumanMessage('첫 질문'),
      new AIMessage('답변'),
      new HumanMessage('현재 질문'),
    ];
    const out = withAnthropicPromptCache(messages);

    const system = out[0]!.content as Block[];
    expect(system[system.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[system.length - 1]!.text).toBe('시스템 프롬프트');

    const lastHuman = out[3]!.content as Block[];
    expect(lastHuman[lastHuman.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(lastHuman[lastHuman.length - 1]!.text).toBe('현재 질문');

    // 중간 메시지는 건드리지 않는다
    expect(out[1]!.content).toBe('첫 질문');
    expect(out[2]!.content).toBe('답변');
    expect(cacheMarkerCount(out)).toBe(2);
  });

  it('입력 메시지를 변형하지 않는다 (비파괴)', () => {
    const messages = [new SystemMessage('sys'), new HumanMessage('질문')];
    withAnthropicPromptCache(messages);
    expect(messages[0]!.content).toBe('sys');
    expect(messages[1]!.content).toBe('질문');
  });

  it('반복 적용해도 breakpoint는 요청당 2개를 유지한다 (멱등)', () => {
    let messages: BaseMessage[] = [
      new SystemMessage('sys'),
      new HumanMessage('질문'),
    ];
    messages = withAnthropicPromptCache(messages);
    // 도구 루프처럼 대화가 자란 뒤 재적용
    messages = [
      ...messages,
      new AIMessage(''),
      new ToolMessage({ tool_call_id: 't1', content: '도구 결과' }),
    ];
    const out = withAnthropicPromptCache(messages);
    expect(cacheMarkerCount(out)).toBe(2);
  });

  it('ToolMessage에는 마커를 붙이지 않는다 (어댑터가 통과시키지 않음)', () => {
    const messages = [
      new SystemMessage('sys'),
      new HumanMessage('질문'),
      new AIMessage(''),
      new ToolMessage({ tool_call_id: 't1', content: '도구 결과' }),
    ];
    const out = withAnthropicPromptCache(messages);
    // 마지막 HumanMessage(질문)가 이동 breakpoint
    const human = out[1]!.content as Block[];
    expect(human[0]!.cache_control).toBeDefined();
    // ToolMessage는 원본 그대로
    expect(out[3]!.content).toBe('도구 결과');
  });

  it('이미지 첨부(멀티모달) HumanMessage는 마지막 마킹 가능 블록에 붙인다', () => {
    const messages = [
      new SystemMessage('sys'),
      new HumanMessage({
        content: [
          { type: 'text', text: '이 이미지 봐줘' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      }),
    ];
    const out = withAnthropicPromptCache(messages);
    const blocks = out[1]!.content as Block[];
    expect(blocks[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0]!.cache_control).toBeUndefined();
  });

  it('빈 시스템 콘텐츠는 마킹하지 않는다', () => {
    const messages = [new SystemMessage(''), new HumanMessage('질문')];
    const out = withAnthropicPromptCache(messages);
    expect(out[0]!.content).toBe('');
    expect(cacheMarkerCount(out)).toBe(1);
  });
});
