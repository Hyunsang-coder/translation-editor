import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { buildLangChainMessages, detectRequestType, type RequestType } from '@/ai/prompt';
import { getSourceDocumentTool, getTargetDocumentTool } from '@/ai/tools/documentTools';
import { suggestTranslationRule, suggestProjectContext } from '@/ai/tools/suggestionTools';
import { braveSearchTool } from '@/ai/tools/braveSearchTool';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { BaseMessage } from '@langchain/core/messages';
import { v4 as uuidv4 } from 'uuid';
import { isTauriRuntime } from '@/tauri/invoke';
import { readFileBytes } from '@/tauri/attachments';

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  for (const x of items) {
    const t = (x ?? '').trim();
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * OpenAI Responses API built-in tools(web_search_preview 등)은 function tool_calls 형태로 노출되지 않을 수 있어
 * message content blocks / annotations를 기반으로 "사용 흔적"을 보수적으로 감지합니다.
 */
function detectOpenAiBuiltInToolsFromMessage(ai: unknown, bindTools: any[]): string[] {
  const hasWebSearchBound = Array.isArray(bindTools) && bindTools.some((t) => t && typeof t === 'object' && (t as any).type === 'web_search_preview');
  if (!hasWebSearchBound) return [];

  const a = ai as any;
  const candidates: string[] = [];

  // 1) Standard content blocks (LangChain v1)
  const blocks = a?.contentBlocks ?? a?.content_blocks;
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      const s = typeof b === 'string' ? b : JSON.stringify(b);
      if (s.includes('web_search')) candidates.push('web_search_preview');
      if (s.includes('url_citation')) candidates.push('web_search_preview');
    }
  }

  // 2) Provider-native content (Responses API는 content가 block array인 경우가 많음)
  const content = a?.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object') {
        const type = String((c as any).type ?? '');
        const annotations = (c as any).annotations;
        if (type.includes('server_tool') || type.includes('tool_result') || type.includes('tool_call')) {
          const s = JSON.stringify(c);
          if (s.includes('web_search')) candidates.push('web_search_preview');
        }
        if (Array.isArray(annotations)) {
          const hasCitation = annotations.some((ann: any) => String(ann?.type ?? '').includes('citation') || JSON.stringify(ann).includes('url_citation'));
          if (hasCitation) candidates.push('web_search_preview');
        }
      }
    }
  }

  // 3) additional_kwargs 등에도 provider별 metadata가 담길 수 있음
  const extra = a?.additional_kwargs ?? a?.additionalKwargs ?? {};
  try {
    const s = JSON.stringify(extra);
    if (s.includes('web_search') || s.includes('url_citation')) candidates.push('web_search_preview');
  } catch {
    // ignore
  }

  return uniqueStrings(candidates);
}

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
  /** Project Context (맥락 정보: 배경 지식, 프로젝트 컨텍스트 등) */
  projectContext?: string;
  /** 원문 문서 */
  sourceDocument?: string;
  /** 번역문 문서 */
  targetDocument?: string;
  /**
   * 웹검색 사용 여부 (tool availability gate)
   * - false면 web search 도구를 모델에 바인딩/노출하지 않습니다.
   */
  webSearchEnabled?: boolean;
  /**
   * (레거시/확장용) 문서 접근 설정
   * - 현재 UX는 토글을 제공하지 않으며, 문서 조회는 on-demand Tool로만 수행합니다.
   */
  includeSourceInPayload?: boolean;
  includeTargetInPayload?: boolean;
  /** 첨부 파일 (추출된 텍스트 목록) */
  attachments?: { filename: string; text: string }[];
  /** 첨부 이미지(로컬 파일 경로) - 멀티모달(vision) 입력으로 전달 */
  imageAttachments?: { filename: string; fileType: string; filePath: string }[];
  /** 요청 유형 (자동 감지 또는 명시적 지정) */
  requestType?: RequestType;
}

export interface StreamCallbacks {
  onToken?: (fullText: string, delta: string) => void;
  onToolsUsed?: (toolNames: string[]) => void;
  onToolCall?: (event: { phase: 'start' | 'end'; toolName: string; args?: any; status?: 'success' | 'error' }) => void;
}

function getToolCallId(call: ToolCall): string {
  return call.id ?? uuidv4();
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function normalizeToolCalls(rawCalls: unknown): ToolCall[] {
  if (!Array.isArray(rawCalls)) return [];

  const out: ToolCall[] = [];
  for (const raw of rawCalls) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as any;

    // OpenAI style: { id, type: 'function', function: { name, arguments } }
    // LangChain normalized: { id, name, args }
    // Anthropic style (possible): { id, name, input }
    const name: string | undefined =
      r.name ??
      r.function?.name ??
      r.tool?.name;

    if (!name || typeof name !== 'string') continue;

    const id: string | undefined =
      r.id ??
      r.tool_call_id ??
      r.toolCallId;

    const argsRaw =
      r.args ??
      r.input ??
      r.function?.arguments ??
      r.arguments;

    const args =
      typeof argsRaw === 'string'
        ? (safeJsonParse(argsRaw) ?? {})
        : (argsRaw ?? {});

    out.push({ ...(id ? { id } : {}), name, args } as ToolCall);
  }

  return out;
}

function extractToolCalls(ai: unknown): ToolCall[] {
  const a = ai as any;
  // 가장 흔한 케이스 우선: ai.tool_calls (LangChain normalized)
  const direct = normalizeToolCalls(a?.tool_calls);
  if (direct.length > 0) return direct;

  // Provider/버전에 따라 additional_kwargs에 들어가는 케이스 대응
  const fromAdditional = normalizeToolCalls(a?.additional_kwargs?.tool_calls ?? a?.additional_kwargs?.toolCalls);
  if (fromAdditional.length > 0) return fromAdditional;

  return [];
}

async function runToolCallingLoop(params: {
  model: ReturnType<typeof createChatModel>;
  /**
   * 실행 가능한(로컬) 도구 목록: tool_calls로 요청이 오면 우리가 직접 invoke합니다.
   */
  tools: Array<{ name: string; invoke: (arg: any) => Promise<any> }>;
  /**
   * 모델에 바인딩할 도구 목록 (OpenAI built-in tools 포함 가능)
   * - 예: { type: "web_search_preview" } 는 OpenAI가 서버 측에서 실행합니다.
   */
  bindTools?: any[];
  messages: BaseMessage[];
  maxSteps?: number;
  cb?: StreamCallbacks;
}): Promise<{ finalText: string; usedTools: boolean; toolsUsed: string[] }> {
  const maxSteps = Math.max(1, Math.min(8, params.maxSteps ?? 4));
  const toolMap = new Map(params.tools.map((t) => [t.name, t]));
  const toolsUsed: string[] = [];

  // 정석: tool calling은 bindTools()로 모델에 도구를 바인딩합니다. (LangChain 공식 문서 패턴)
  // - Provider/버전에 따라 bindTools 유무가 다를 수 있어 방어적으로 처리합니다.
  const modelAny = params.model as any;
  const bindTools = params.bindTools ?? params.tools;
  const modelWithTools =
    bindTools.length > 0 && typeof modelAny.bindTools === 'function'
      ? modelAny.bindTools(bindTools)
      : params.model;

  const loopMessages: BaseMessage[] = [...params.messages];

  for (let step = 0; step < maxSteps; step++) {
    const ai = await (modelWithTools as any).invoke(loopMessages);
    loopMessages.push(ai);

    // OpenAI built-in tools(web_search_preview 등)은 function tool_calls로 노출되지 않을 수 있어 별도 감지
    const builtIns = detectOpenAiBuiltInToolsFromMessage(ai, bindTools);
    for (const t of builtIns) {
      if (!toolsUsed.includes(t)) toolsUsed.push(t);
    }
    if (builtIns.length > 0) {
      console.info('[AI builtin_tools_used]', builtIns);
    }

    const toolCalls: ToolCall[] = extractToolCalls(ai);
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
      console.info('[AI tool_call]', { name: call.name, args: call.args ?? {} });
      if (!tool) {
        params.cb?.onToolCall?.({ phase: 'start', toolName: call.name, args: call.args });
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
        params.cb?.onToolCall?.({ phase: 'start', toolName: call.name, args: call.args });
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

function buildToolGuideMessage(params: { includeSource: boolean; includeTarget: boolean; provider: string; webSearchEnabled?: boolean }): SystemMessage {
  const { includeSource, includeTarget, provider } = params;
  const hasOpenAiWebSearch = provider === 'openai';
  const webSearchEnabled = !!params.webSearchEnabled;
  const toolGuide = [
    '도구 사용 가이드(짧게):',
    includeSource
      ? '- get_source_document: 원문을 가져옴(문서가 아주 길면 일부만 반환될 수 있음). 꼭 필요할 때만.'
      : '- get_source_document: (비활성화됨)',
    includeTarget
      ? '- get_target_document: 번역문을 가져옴(문서가 아주 길면 일부만 반환될 수 있음). 꼭 필요할 때만.'
      : '- get_target_document: (비활성화됨)',
    '- suggest_translation_rule: "번역 규칙 저장 제안" 생성(실제 저장은 사용자가 버튼 클릭)',
    '- suggest_project_context: "Project Context 저장 제안" 생성(실제 저장은 사용자가 버튼 클릭)',
    (webSearchEnabled && hasOpenAiWebSearch)
      ? '- web_search_preview: (OpenAI 내장) 최신 정보/뉴스/기술 문서 등 웹 검색이 필요할 때 사용. 가능한 경우 이 도구를 우선 사용.'
      : '- web_search_preview: (비활성화됨)',
    webSearchEnabled
      ? '- brave_search: (fallback) 웹 검색이 필요하지만 web_search_preview가 비활성/실패/제약일 때 사용.'
      : '- brave_search: (비활성화됨)',
    '',
    '규칙:',
    '- 번역 검수/대조/정확성 확인(누락/오역/고유명사/기관명 등) 요청이면, 사용자가 문서를 붙이길 기다리기 전에 get_source_document + get_target_document를 먼저 호출한다.',
    '- 문서가 길면 query/maxChars를 사용해 필요한 구간만 가져온다.',
    '- 그 외에는 문서 조회는 질문/검수에 꼭 필요할 때만 호출한다.',
    '- suggest_* 호출 후 응답에는 "저장/추가 완료"라고 쓰지 말고, 필요 시 "원하시면 버튼을 눌러 추가하세요"라고 안내한다.',
    ...(webSearchEnabled
      ? [
        hasOpenAiWebSearch
          ? '- 최신 정보/실시간 데이터가 필요한 질문에는 web_search_preview를 우선 사용하고, 불가능하면 brave_search를 사용한다.'
          : '- 최신 정보/실시간 데이터가 필요한 질문에는 brave_search를 사용한다.',
      ]
      : []),
  ].join('\n');

  return new SystemMessage(toolGuide);
}

function isImageExt(ext: string): boolean {
  const e = (ext ?? '').toLowerCase();
  return e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'webp' || e === 'gif';
}

function bytesToBase64(bytes: Uint8Array): string {
  // btoa는 Latin-1 문자열을 기대하므로 chunk로 변환합니다.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function maybeReplaceLastHumanMessageWithImages(params: {
  messages: BaseMessage[];
  userText: string;
  imageAttachments?: { filename: string; fileType: string; filePath: string }[];
}): Promise<BaseMessage[]> {
  const images = (params.imageAttachments ?? []).filter((x) => x && isImageExt(x.fileType) && !!x.filePath);
  if (images.length === 0) return params.messages;
  if (!isTauriRuntime()) return params.messages;

  const MAX_IMAGES = 3;
  const MAX_IMAGE_BYTES = 2_000_000; // 2MB

  const blocks: any[] = [{ type: 'text', text: params.userText }];
  const warnings: string[] = [];

  for (const img of images.slice(0, MAX_IMAGES)) {
    try {
      const raw = await readFileBytes(img.filePath);
      const bytes = new Uint8Array(raw);
      if (bytes.length > MAX_IMAGE_BYTES) {
        warnings.push(`- ${img.filename}: 파일이 너무 커서(${Math.round(bytes.length / 1024)}KB) 제외됨`);
        continue;
      }
      blocks.push({
        type: 'image',
        source_type: 'base64',
        data: bytesToBase64(bytes),
      });
    } catch {
      warnings.push(`- ${img.filename}: 파일을 읽을 수 없어 제외됨`);
    }
  }

  if (warnings.length > 0) {
    blocks[0] = {
      type: 'text',
      text: [params.userText, '', '[첨부 이미지 제외됨]', ...warnings].join('\n'),
    };
  }

  // buildLangChainMessages()가 만든 마지막 HumanMessage를 멀티모달 HumanMessage로 교체합니다.
  const next = [...params.messages];
  const lastIdx = next.length - 1;
  next[lastIdx] = new HumanMessage({ content: blocks });
  return next;
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

  const model = createChatModel(undefined, { useFor: 'chat' });
  const includeSource = true;
  const includeTarget = true;
  const webSearchEnabled = !!input.webSearchEnabled;

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
      ...(input.projectContext ? { projectContext: input.projectContext } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      ...(targetDocument ? { targetDocument } : {}),
    },
    {
      ...(input.translatorPersona ? { translatorPersona: input.translatorPersona } : {}),
      requestType,
    },
  );

  const toolSpecs: any[] = [
    suggestTranslationRule,
    suggestProjectContext,
    ...(webSearchEnabled ? [braveSearchTool] : []),
  ];
  if (includeSource) toolSpecs.push(getSourceDocumentTool);
  if (includeTarget) toolSpecs.push(getTargetDocumentTool);

  // OpenAI provider에서는 built-in web search를 모델에 바인딩 (서버 측에서 실행됨)
  const openAiBuiltInTools = (webSearchEnabled && cfg.provider === 'openai') ? [{ type: 'web_search_preview' }] : [];
  const bindTools = [...toolSpecs, ...openAiBuiltInTools];

  const messagesWithGuide: BaseMessage[] = [
    // systemPrompt 바로 다음에 가이드를 넣어 tool 사용 원칙을 고정
    messages[0] ?? new SystemMessage(''),
    buildToolGuideMessage({ includeSource, includeTarget, provider: cfg.provider, webSearchEnabled }),
    ...messages.slice(1),
  ];
  const finalMessages = await maybeReplaceLastHumanMessageWithImages({
    messages: messagesWithGuide,
    userText: input.userMessage,
    ...(input.imageAttachments ? { imageAttachments: input.imageAttachments } : {}),
  });

  const { finalText } = await runToolCallingLoop({
    model,
    tools: toolSpecs as any,
    bindTools,
    messages: finalMessages,
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

  const model = createChatModel(undefined, { useFor: 'chat' });
  const includeSource = true;
  const includeTarget = true;
  const webSearchEnabled = !!input.webSearchEnabled;

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
      ...(input.projectContext ? { projectContext: input.projectContext } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      ...(targetDocument ? { targetDocument } : {}),
    },
    {
      ...(input.translatorPersona ? { translatorPersona: input.translatorPersona } : {}),
      requestType,
    },
  );

  const toolSpecs: any[] = [
    suggestTranslationRule,
    suggestProjectContext,
    ...(webSearchEnabled ? [braveSearchTool] : []),
  ];
  if (includeSource) toolSpecs.push(getSourceDocumentTool);
  if (includeTarget) toolSpecs.push(getTargetDocumentTool);

  const openAiBuiltInTools = (webSearchEnabled && cfg.provider === 'openai') ? [{ type: 'web_search_preview' }] : [];
  const bindTools = [...toolSpecs, ...openAiBuiltInTools];

  const messagesWithGuide: BaseMessage[] = [
    messages[0] ?? new SystemMessage(''),
    buildToolGuideMessage({ includeSource, includeTarget, provider: cfg.provider, webSearchEnabled }),
    ...messages.slice(1),
  ];
  const finalMessages = await maybeReplaceLastHumanMessageWithImages({
    messages: messagesWithGuide,
    userText: input.userMessage,
    ...(input.imageAttachments ? { imageAttachments: input.imageAttachments } : {}),
  });

  const { finalText, toolsUsed } = await runToolCallingLoop({
    model,
    tools: toolSpecs as any,
    bindTools,
    messages: finalMessages,
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
