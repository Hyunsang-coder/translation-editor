import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { compressOldToolMessages } from './chat';

function toolMsg(id: string, content: string): ToolMessage {
  return new ToolMessage({ tool_call_id: id, status: 'success', content });
}

describe('compressOldToolMessages (Phase 4 도구 결과 축약)', () => {
  it('오래되고 큰 tool result는 digest로 축약, 최근 것과 작은 것은 원문 유지', () => {
    const big = 'A'.repeat(5000);
    const names = new Map([
      ['t1', 'get_source_document'],
      ['t2', 'notion_search'],
      ['t3', 'get_target_document'],
    ]);
    const messages = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      new AIMessage('call1'),
      toolMsg('t1', big), // 오래됨 + 큼 → 축약 대상
      new AIMessage('call2'),
      toolMsg('t2', 'short result'), // 작음 → 유지
      new AIMessage('call3'),
      toolMsg('t3', big), // 최근 → 유지
    ];

    compressOldToolMessages(messages, names, { keepRecent: 1 });

    // t1: 축약됨 (도구 이름 라벨 포함)
    expect(String((messages[3] as ToolMessage).content)).toMatch(/^\[cleared: get_source_document \|/);
    // t2: 작아서 유지
    expect((messages[5] as ToolMessage).content).toBe('short result');
    // t3: 최근이라 유지
    expect((messages[7] as ToolMessage).content).toBe(big);
  });

  it('메시지 개수와 tool_call_id 쌍은 보존된다', () => {
    const big = 'B'.repeat(5000);
    const messages = [new AIMessage('c1'), toolMsg('x1', big), new AIMessage('c2'), toolMsg('x2', big)];
    const before = messages.length;
    compressOldToolMessages(messages, new Map([['x1', 'foo']]), { keepRecent: 1 });
    expect(messages).toHaveLength(before);
    expect((messages[1] as ToolMessage).tool_call_id).toBe('x1');
    expect((messages[3] as ToolMessage).tool_call_id).toBe('x2');
  });

  it('이미 축약된 결과는 다시 축약하지 않는다(멱등)', () => {
    const messages = [
      new AIMessage('c1'),
      toolMsg('t1', 'A'.repeat(5000)),
      new AIMessage('c2'),
      toolMsg('t2', 'A'.repeat(5000)),
    ];
    compressOldToolMessages(messages, new Map(), { keepRecent: 1 });
    const firstPass = String((messages[1] as ToolMessage).content);
    compressOldToolMessages(messages, new Map(), { keepRecent: 1 });
    expect(String((messages[1] as ToolMessage).content)).toBe(firstPass);
  });
});
