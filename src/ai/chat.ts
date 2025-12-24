import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { buildLangChainMessages, detectRequestType, type RequestType } from '@/ai/prompt';
import { getSourceDocumentTool, getTargetDocumentTool } from '@/ai/tools/documentTools';
import { SystemMessage, ToolMessage, type ToolCall } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { v4 as uuidv4 } from 'uuid';

export interface GenerateReplyInput {
  project: ITEProject | null;
  contextBlocks: EditorBlock[];
  recentMessages: ChatMessage[];
  userMessage: string;
  translatorPersona?: string;
  /** 번역 규칙 (사용자 입력) */
  translationRules?: string;
  /** 글로서리 주입 결과(plain text) */
  glossaryInjected?: string;
  /** Active Memory (용어/톤 규칙 요약) */
  activeMemory?: string;
  /** 원문 문서 */
  sourceDocument?: string;
  /** 번역문 문서 */
  targetDocument?: string;
  /** Source 문서 접근 허용 여부(도구 사용 포함) */
  includeSourceInPayload?: boolean;
  /** Target 문서 접근 허용 여부(도구 사용 포함) */
  includeTargetInPayload?: boolean;
  /** 요청 유형 (자동 감지 또는 명시적 지정) */
  requestType?: RequestType;
}

export interface StreamCallbacks {
  onToken?: (fullText: string, delta: string) => void;
  onToolsUsed?: (toolNames: string[]) => void;
  onToolCall?: (event: { phase: 'start' | 'end'; toolName: string; status?: 'success' | 'error' }) => void;
}

function getToolCallId(call: ToolCall): string {
  return call.id ?? uuidv4();
}

async function runToolCallingLoop(params: {
  model: ReturnType<typeof createChatModel>;
  tools: Array<{ name: string; invoke: (arg: any) => Promise<any> }>;
  messages: BaseMessage[];
  maxSteps?: number;
  cb?: StreamCallbacks;
}): Promise<{ finalText: string; usedTools: boolean; toolsUsed: string[] }> {
  const maxSteps = Math.max(1, Math.min(8, params.maxSteps ?? 4));
  const toolMap = new Map(params.tools.map((t) => [t.name, t]));
  const toolsUsed: string[] = [];

  // Provider 별 tool binding 지원을 사용 (OpenAI/Anthropic 모두 bindTools 제공)
  const modelAny = params.model as any;
  const modelWithTools = typeof modelAny.bindTools === 'function' ? modelAny.bindTools(params.tools) : params.model;

  const loopMessages: BaseMessage[] = [...params.messages];

  for (let step = 0; step < maxSteps; step++) {
    const ai = await (modelWithTools as any).invoke(loopMessages);
    loopMessages.push(ai);

    const toolCalls: ToolCall[] = (ai as any)?.tool_calls ?? [];
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      const content = (ai as any)?.content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((c) => (typeof c === 'string' ? c : typeof c === 'object' && c && 'text' in c ? String((c as any).text ?? '') : '')).join('')
            : JSON.stringify(content);
      return { finalText: text, usedTools: toolsUsed.length > 0, toolsUsed };
    }

    for (const call of toolCalls) {
      const tool = toolMap.get(call.name);
      const toolCallId = getToolCallId(call);
      if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);
      // 문서 내용은 로그로 찍지 않음(보안/노이즈 방지). 도구명/인자만 로깅.
      console.debug('[AI tool_call]', { name: call.name, args: call.args ?? {} });
      if (!tool) {
        params.cb?.onToolCall?.({ phase: 'start', toolName: call.name });
        loopMessages.push(
          new ToolMessage({
            tool_call_id: toolCallId,
            status: 'error',
            content: `Tool not found: ${call.name}`,
          }),
        );
        params.cb?.onToolCall?.({ phase: 'end', toolName: call.name, status: 'error' });
        continue;
      }

      try {
        params.cb?.onToolCall?.({ phase: 'start', toolName: call.name });
        const out = await tool.invoke(call.args ?? {});
        const content = typeof out === 'string' ? out : JSON.stringify(out);
        loopMessages.push(
          new ToolMessage({
            tool_call_id: toolCallId,
            status: 'success',
            content,
          }),
        );
        params.cb?.onToolCall?.({ phase: 'end', toolName: call.name, status: 'success' });
      } catch (e) {
        loopMessages.push(
          new ToolMessage({
            tool_call_id: toolCallId,
            status: 'error',
            content: e instanceof Error ? e.message : 'Tool execution failed',
          }),
        );
        params.cb?.onToolCall?.({ phase: 'end', toolName: call.name, status: 'error' });
      }
    }
  }

  return {
    finalText: '요청을 처리하는 데 필요한 컨텍스트를 충분히 확보하지 못했습니다. 질문을 더 구체화하거나, 필요한 문서/블록을 선택해 주세요.',
    usedTools: true,
    toolsUsed,
  };
}

function buildToolGuideMessage(includeSource: boolean, includeTarget: boolean): SystemMessage {
  const toolGuide = [
    '문서/문맥 접근 도구:',
    includeSource ? '- get_source_document: 원문(Source) 문서를 가져옵니다.' : '- get_source_document: (비활성화됨)',
    includeTarget ? '- get_target_document: 번역문(Target) 문서를 가져옵니다.' : '- get_target_document: (비활성화됨)',
    '',
    '규칙:',
    '- 질문에 답하기 위해 원문/번역문이 꼭 필요할 때만 도구를 호출하세요.',
    '- 일반적인 개념 질문은 도구 호출 없이 답하세요.',
  ].join('\n');

  return new SystemMessage(toolGuide);
}

/**
 * AI 응답 생성 (non-streaming)
 */
export async function generateAssistantReply(input: GenerateReplyInput): Promise<string> {
  const cfg = getAiConfig();

  if (cfg.provider === 'mock') {
    return getMockResponse(input);
  }

  // 요청 유형 자동 감지
  const requestType = input.requestType ?? detectRequestType(input.userMessage);

  const model = createChatModel();
  const includeSource = input.includeSourceInPayload ?? true;
  const includeTarget = input.includeTargetInPayload ?? true;

  // 토큰 최적화(=on-demand): 초기 호출에서 Source/Target을 기본으로 인라인 포함하지 않습니다.
  // 필요 시 모델이 tool_call로 문서를 가져오게 합니다. (TRD 3.2 업데이트 반영)
  const sourceDocument = undefined;
  const targetDocument = undefined;

  const messages = await buildLangChainMessages(
    {
      project: input.project,
      contextBlocks: input.contextBlocks,
      recentMessages: input.recentMessages,
      userMessage: input.userMessage,
      ...(input.translationRules ? { translationRules: input.translationRules } : {}),
      ...(input.glossaryInjected ? { glossaryInjected: input.glossaryInjected } : {}),
      ...(input.activeMemory ? { activeMemory: input.activeMemory } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      ...(targetDocument ? { targetDocument } : {}),
    },
    {
      ...(input.translatorPersona ? { translatorPersona: input.translatorPersona } : {}),
      requestType,
    },
  );

  const toolSpecs: any[] = [];
  if (includeSource) toolSpecs.push(getSourceDocumentTool);
  if (includeTarget) toolSpecs.push(getTargetDocumentTool);

  const messagesWithGuide: BaseMessage[] = [
    // systemPrompt 바로 다음에 가이드를 넣어 tool 사용 원칙을 고정
    messages[0] ?? new SystemMessage(''),
    buildToolGuideMessage(includeSource, includeTarget),
    ...messages.slice(1),
  ];

  const { finalText } = await runToolCallingLoop({
    model,
    tools: toolSpecs as any,
    messages: messagesWithGuide,
  });

  return finalText;
}

/**
 * AI 응답 생성 (streaming)
 */
export async function streamAssistantReply(
  input: GenerateReplyInput,
  cb?: StreamCallbacks,
): Promise<string> {
  const cfg = getAiConfig();

  if (cfg.provider === 'mock') {
    const mock = getMockResponse(input);
    cb?.onToken?.(mock, mock);
    return mock;
  }

  // 요청 유형 자동 감지
  const requestType = input.requestType ?? detectRequestType(input.userMessage);

  const model = createChatModel();
  const includeSource = input.includeSourceInPayload ?? true;
  const includeTarget = input.includeTargetInPayload ?? true;

  // 토큰 최적화(=on-demand): 초기 호출에서 Source/Target을 기본으로 인라인 포함하지 않습니다.
  // 필요 시 모델이 tool_call로 문서를 가져오게 합니다. (TRD 3.2 업데이트 반영)
  const sourceDocument = undefined;
  const targetDocument = undefined;

  const messages = await buildLangChainMessages(
    {
      project: input.project,
      contextBlocks: input.contextBlocks,
      recentMessages: input.recentMessages,
      userMessage: input.userMessage,
      ...(input.translationRules ? { translationRules: input.translationRules } : {}),
      ...(input.glossaryInjected ? { glossaryInjected: input.glossaryInjected } : {}),
      ...(input.activeMemory ? { activeMemory: input.activeMemory } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      ...(targetDocument ? { targetDocument } : {}),
    },
    {
      ...(input.translatorPersona ? { translatorPersona: input.translatorPersona } : {}),
      requestType,
    },
  );

  const toolSpecs: any[] = [];
  if (includeSource) toolSpecs.push(getSourceDocumentTool);
  if (includeTarget) toolSpecs.push(getTargetDocumentTool);

  const messagesWithGuide: BaseMessage[] = [
    messages[0] ?? new SystemMessage(''),
    buildToolGuideMessage(includeSource, includeTarget),
    ...messages.slice(1),
  ];

  const { finalText, toolsUsed } = await runToolCallingLoop({
    model,
    tools: toolSpecs as any,
    messages: messagesWithGuide,
    ...(cb ? { cb } : {}),
  });

  cb?.onToolsUsed?.(toolsUsed);

  // 실제 모델 토큰 스트리밍 대신, 결과를 UI에 점진적으로 전달(추가 모델 호출 없이 비용 절감)
  let full = '';
  const chunkSize = 24;
  for (let i = 0; i < finalText.length; i += chunkSize) {
    const delta = finalText.slice(i, i + chunkSize);
    full += delta;
    cb?.onToken?.(full, delta);
  }
  return full;
}

/**
 * Mock 응답 생성 (개발/테스트용)
 */
function getMockResponse(input: GenerateReplyInput): string {
  const requestType = detectRequestType(input.userMessage);

  const mockResponses: Record<RequestType, string> = {
    translate: '(Mock 번역 결과) 이것은 테스트 번역입니다.',
    question: '(Mock 답변) 질문에 대한 테스트 답변입니다.',
    general: [
      '현재 AI_PROVIDER가 mock이라 실제 모델 호출은 하지 않았습니다.',
      '',
      `입력: ${input.userMessage}`,
      `요청 유형: ${requestType}`,
      '',
      'VITE_AI_PROVIDER=openai 또는 anthropic 으로 설정하고 API 키를 입력하면 실제 호출로 전환됩니다.',
    ].join('\n'),
  };

  return mockResponses[requestType];
}
