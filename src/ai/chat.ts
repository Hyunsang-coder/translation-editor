import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { buildLangChainMessages, detectRequestType, type RequestType } from '@/ai/prompt';

export interface GenerateReplyInput {
  project: ITEProject | null;
  contextBlocks: EditorBlock[];
  recentMessages: ChatMessage[];
  userMessage: string;
  systemPromptOverlay?: string;
  /** 번역 규칙 (사용자 입력) */
  translationRules?: string;
  /** Active Memory (용어/톤 규칙 요약) */
  activeMemory?: string;
  /** 원문 문서 */
  sourceDocument?: string;
  /** 번역문 문서 */
  targetDocument?: string;
  /** 요청 유형 (자동 감지 또는 명시적 지정) */
  requestType?: RequestType;
}

export interface StreamCallbacks {
  onToken?: (fullText: string, delta: string) => void;
}

function extractChunkContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c && 'text' in c) {
          return String((c as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
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
  const messages = await buildLangChainMessages(
    {
      project: input.project,
      contextBlocks: input.contextBlocks,
      recentMessages: input.recentMessages,
      userMessage: input.userMessage,
      ...(input.translationRules ? { translationRules: input.translationRules } : {}),
      ...(input.activeMemory ? { activeMemory: input.activeMemory } : {}),
      ...(input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}),
      ...(input.targetDocument ? { targetDocument: input.targetDocument } : {}),
    },
    {
      ...(input.systemPromptOverlay ? { systemPromptOverlay: input.systemPromptOverlay } : {}),
      requestType,
    },
  );

  const res = await model.invoke(messages);
  const content = res.content;

  if (typeof content === 'string') return content;
  return JSON.stringify(content);
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
  const messages = await buildLangChainMessages(
    {
      project: input.project,
      contextBlocks: input.contextBlocks,
      recentMessages: input.recentMessages,
      userMessage: input.userMessage,
      ...(input.translationRules ? { translationRules: input.translationRules } : {}),
      ...(input.activeMemory ? { activeMemory: input.activeMemory } : {}),
      ...(input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}),
      ...(input.targetDocument ? { targetDocument: input.targetDocument } : {}),
    },
    {
      ...(input.systemPromptOverlay ? { systemPromptOverlay: input.systemPromptOverlay } : {}),
      requestType,
    },
  );

  const stream = await model.stream(messages);
  let full = '';

  for await (const chunk of stream) {
    const delta = extractChunkContent(chunk.content);
    if (!delta) continue;
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
