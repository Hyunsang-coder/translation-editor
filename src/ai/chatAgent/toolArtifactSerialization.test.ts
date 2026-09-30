import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatPromptValue } from '@langchain/core/prompt_values';
import { convertPromptToAnthropic } from '@langchain/anthropic';
import {
  convertMessagesToCompletionsMessageParams,
  convertMessagesToResponsesInput,
} from '@langchain/openai';

/**
 * 도구 artifact는 앱 전용 데이터다. 프로바이더 어댑터가 ToolMessage를 요청으로 직렬화할 때
 * artifact를 싣지 않는다는 라이브러리 동작에 감사 id 분리가 의존하므로, 업그레이드 시
 * 이 가정이 깨지면 여기서 잡는다.
 */
const SECRET = 'SECRET_AUDIT_ID';

function conversation() {
  return [
    new HumanMessage('용어 알려줘'),
    new AIMessage({
      content: '',
      tool_calls: [{ id: 'call-1', name: 'search_project_glossary', args: { query: 'zone' } }],
    }),
    new ToolMessage({
      tool_call_id: 'call-1',
      name: 'search_project_glossary',
      content: 'VISIBLE_TOOL_CONTENT',
      artifact: { glossaryEntryIds: [SECRET] },
    }),
  ];
}

describe('도구 artifact의 프로바이더 요청 직렬화', () => {
  it('Anthropic 요청에는 content만 실리고 artifact는 실리지 않는다', () => {
    const payload = JSON.stringify(convertPromptToAnthropic(new ChatPromptValue(conversation())));

    expect(payload).toContain('VISIBLE_TOOL_CONTENT');
    expect(payload).not.toContain(SECRET);
  });

  it('OpenAI Chat Completions 요청에는 content만 실리고 artifact는 실리지 않는다', () => {
    const payload = JSON.stringify(
      convertMessagesToCompletionsMessageParams({ messages: conversation(), model: 'gpt-5' }),
    );

    expect(payload).toContain('VISIBLE_TOOL_CONTENT');
    expect(payload).not.toContain(SECRET);
  });

  it('OpenAI Responses 요청에는 content만 실리고 artifact는 실리지 않는다', () => {
    const payload = JSON.stringify(
      convertMessagesToResponsesInput({ messages: conversation(), zdrEnabled: false, model: 'gpt-5' }),
    );

    expect(payload).toContain('VISIBLE_TOOL_CONTENT');
    expect(payload).not.toContain(SECRET);
  });
});
