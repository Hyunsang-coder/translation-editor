import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { buildLangChainMessages } from '@/ai/prompt';

export interface GenerateReplyInput {
  project: ITEProject | null;
  contextBlocks: EditorBlock[];
  recentMessages: ChatMessage[];
  userMessage: string;
  systemPromptOverlay?: string;
  referenceNotes?: string;
  /**
   * 로컬 글로서리 검색 결과(주입)
   * - On-demand: sendMessage/sendApplyRequest 같은 “모델 호출” 시에만 구성
   */
  glossaryInjected?: string;
  fallbackSourceText?: string;
  activeMemory?: string;
  sourceDocument?: string;
  targetDocument?: string;
}

export interface StreamCallbacks {
  onToken?: (fullText: string, delta: string) => void;
}

function extractChunkContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Anthropic/Multimodal content shape: [{ type: 'text', text: '...' }]
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

export async function generateAssistantReply(input: GenerateReplyInput): Promise<string> {
  const cfg = getAiConfig();

  if (cfg.provider === 'mock') {
    return [
      '현재 AI_PROVIDER가 mock이라 실제 모델 호출은 하지 않았습니다.',
      '',
      `입력: ${input.userMessage}`,
      input.contextBlocks.length > 0
        ? `컨텍스트 블록 수: ${input.contextBlocks.length}`
        : '컨텍스트 블록 없음',
      '',
      'VITE_AI_PROVIDER=openai 또는 anthropic 로 바꾸고 API 키를 설정하면 실제 호출로 전환됩니다.',
    ].join('\n');
  }

  const model = createChatModel();
  const messages = buildLangChainMessages(
    {
      project: input.project,
      contextBlocks: input.contextBlocks,
      recentMessages: input.recentMessages,
      userMessage: input.userMessage,
      ...(input.referenceNotes ? { referenceNotes: input.referenceNotes } : {}),
      ...(input.glossaryInjected ? { glossaryInjected: input.glossaryInjected } : {}),
      ...(input.fallbackSourceText ? { fallbackSourceText: input.fallbackSourceText } : {}),
      ...(input.activeMemory ? { activeMemory: input.activeMemory } : {}),
      ...(input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}),
      ...(input.targetDocument ? { targetDocument: input.targetDocument } : {}),
    },
    input.systemPromptOverlay ? { systemPromptOverlay: input.systemPromptOverlay } : undefined,
  );

  const res = await model.invoke(messages);
  const content = res.content;

  if (typeof content === 'string') return content;
  // 일부 모델은 content가 블록 배열로 올 수 있어 stringify
  return JSON.stringify(content);
}

export async function streamAssistantReply(
  input: GenerateReplyInput,
  cb?: StreamCallbacks,
): Promise<string> {
  const cfg = getAiConfig();

  if (cfg.provider === 'mock') {
    const mock = [
      '현재 AI_PROVIDER가 mock이라 실제 모델 호출은 하지 않았습니다.',
      '',
      `입력: ${input.userMessage}`,
      input.contextBlocks.length > 0
        ? `컨텍스트 블록 수: ${input.contextBlocks.length}`
        : '컨텍스트 블록 없음',
      '',
      'VITE_AI_PROVIDER=openai 또는 anthropic 로 바꾸고 API 키를 설정하면 실제 호출로 전환됩니다.',
    ].join('\n');
    cb?.onToken?.(mock, mock);
    return mock;
  }

  const model = createChatModel();
  const messages = buildLangChainMessages(
    {
      project: input.project,
      contextBlocks: input.contextBlocks,
      recentMessages: input.recentMessages,
      userMessage: input.userMessage,
      ...(input.referenceNotes ? { referenceNotes: input.referenceNotes } : {}),
      ...(input.glossaryInjected ? { glossaryInjected: input.glossaryInjected } : {}),
      ...(input.fallbackSourceText ? { fallbackSourceText: input.fallbackSourceText } : {}),
      ...(input.activeMemory ? { activeMemory: input.activeMemory } : {}),
      ...(input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}),
      ...(input.targetDocument ? { targetDocument: input.targetDocument } : {}),
    },
    input.systemPromptOverlay ? { systemPromptOverlay: input.systemPromptOverlay } : undefined,
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


