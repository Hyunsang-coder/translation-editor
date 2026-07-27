import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { countTokensApproximately } from 'langchain';
import { ToolResultCompactionEdit } from './toolResultCompaction';

function toolMsg(id: string, content: string, name?: string): ToolMessage {
  return new ToolMessage({
    tool_call_id: id,
    status: 'success',
    content,
    ...(name ? { name } : {}),
  });
}

async function apply(messages: ToolMessage[] | Parameters<ToolResultCompactionEdit['apply']>[0]['messages'], keepRecent: number) {
  await new ToolResultCompactionEdit({ keepRecent }).apply({
    messages: messages as Parameters<ToolResultCompactionEdit['apply']>[0]['messages'],
    countTokens: countTokensApproximately,
  });
}

describe('ToolResultCompactionEdit (도구 결과 축약)', () => {
  it('오래되고 큰 tool result는 digest로 축약, 최근 것과 작은 것은 원문 유지', async () => {
    const big = 'A'.repeat(5000);
    const messages = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      new AIMessage('call1'),
      toolMsg('t1', big, 'get_source_document'), // 오래됨 + 큼 → 축약 대상
      new AIMessage('call2'),
      toolMsg('t2', 'short result', 'notion_search'), // 작음 → 유지
      new AIMessage('call3'),
      toolMsg('t3', big, 'get_target_document'), // 최근 → 유지
    ];

    await apply(messages, 1);

    expect(String((messages[3] as ToolMessage).content)).toMatch(
      /^\[cleared: get_source_document \|/,
    );
    expect((messages[5] as ToolMessage).content).toBe('short result');
    expect((messages[7] as ToolMessage).content).toBe(big);
  });

  it('메시지 개수와 tool_call_id 쌍은 보존된다', async () => {
    const big = 'B'.repeat(5000);
    const messages = [
      new AIMessage('c1'),
      toolMsg('x1', big, 'foo'),
      new AIMessage('c2'),
      toolMsg('x2', big),
    ];
    const before = messages.length;

    await apply(messages, 1);

    expect(messages).toHaveLength(before);
    expect((messages[1] as ToolMessage).tool_call_id).toBe('x1');
    expect((messages[3] as ToolMessage).tool_call_id).toBe('x2');
  });

  it('이미 축약된 결과는 다시 축약하지 않는다(멱등)', async () => {
    const messages = [
      new AIMessage('c1'),
      toolMsg('t1', 'A'.repeat(5000)),
      new AIMessage('c2'),
      toolMsg('t2', 'A'.repeat(5000)),
    ];

    await apply(messages, 1);
    const firstPass = String((messages[1] as ToolMessage).content);
    await apply(messages, 1);

    expect(String((messages[1] as ToolMessage).content)).toBe(firstPass);
  });

  it('도구 이름을 모르면 일반 라벨로 축약한다', async () => {
    const messages = [
      new AIMessage('c1'),
      toolMsg('t1', 'C'.repeat(5000)),
      new AIMessage('c2'),
      toolMsg('t2', 'C'.repeat(5000)),
    ];

    await apply(messages, 1);

    expect(String((messages[1] as ToolMessage).content)).toMatch(/^\[cleared: tool \|/);
  });
});
