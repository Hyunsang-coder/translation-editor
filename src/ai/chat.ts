import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { buildLangChainMessages, detectRequestType, type RequestType } from '@/ai/prompt';
import { getSourceDocumentTool, getTargetDocumentTool } from '@/ai/tools/documentTools';
import { suggestTranslationRule, suggestProjectContext } from '@/ai/tools/suggestionTools';
import { AIMessageChunk, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { ToolCall, ToolCallChunk } from '@langchain/core/messages/tool';
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

import { mcpClientManager } from '@/ai/mcp/McpClientManager';
import { buildConnectorTools, type ConnectorConfig } from '@/ai/connectors';

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
   * Confluence 검색 사용 여부 (tool availability gate)
   * - false면 Rovo MCP 도구를 모델에 바인딩/노출하지 않습니다.
   */
  confluenceSearchEnabled?: boolean;
  /**
   * Notion 검색 사용 여부 (tool availability gate)
   * - false면 Notion 도구를 모델에 바인딩/노출하지 않습니다.
   */
  notionSearchEnabled?: boolean;
  /**
   * 활성화된 커넥터 설정 목록
   * - OpenAI 빌트인 커넥터 (Google, Dropbox, Microsoft 등)
   */
  connectorConfigs?: ConnectorConfig[];
  /**
   * 커넥터 토큰 조회 함수
   */
  getConnectorToken?: (connectorId: string) => Promise<string | null>;
  /**
   * 요청 취소용 AbortSignal
   */
  abortSignal?: AbortSignal;
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
  /** 모델 실행(생각) 시작 시 호출 */
  onModelRun?: (step: number) => void;
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

/**
 * 스트리밍 청크에서 텍스트 콘텐츠 추출
 */
function extractChunkContent(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c && 'text' in c) return String((c as any).text ?? '');
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 도구 호출 청크를 병합하여 완성된 ToolCall 배열로 변환
 * LangChain은 tool_call_chunks를 여러 청크에 걸쳐 전송할 수 있음
 */
function mergeToolCallChunks(chunks: ToolCallChunk[]): ToolCall[] {
  // index별로 청크를 그룹화
  const byIndex = new Map<number, ToolCallChunk[]>();
  for (const chunk of chunks) {
    const idx = chunk.index ?? 0;
    if (!byIndex.has(idx)) byIndex.set(idx, []);
    byIndex.get(idx)!.push(chunk);
  }

  const result: ToolCall[] = [];
  for (const [, groupChunks] of byIndex) {
    let id = '';
    let name = '';
    let argsStr = '';
    for (const c of groupChunks) {
      if (c.id) id = c.id;
      if (c.name) name = c.name;
      if (c.args) argsStr += c.args;
    }
    if (name) {
      const args = safeJsonParse(argsStr) ?? {};
      result.push({ id: id || uuidv4(), name, args } as ToolCall);
    }
  }
  return result;
}

/**
 * 실시간 토큰 스트리밍을 지원하는 도구 호출 루프
 * - LangChain .stream() API를 사용하여 토큰별로 UI에 전달
 * - 도구 호출 시 도구 실행 후 재스트리밍
 */
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
  abortSignal?: AbortSignal;
}): Promise<{ finalText: string; usedTools: boolean; toolsUsed: string[] }> {
  const maxSteps = Math.max(1, Math.min(12, params.maxSteps ?? 6));
  const toolMap = new Map(params.tools.map((t) => [t.name, t]));
  const toolsUsed: string[] = [];

  // 정석: tool calling은 bindTools()로 모델에 도구를 바인딩합니다. (LangChain 공식 문서 패턴)
  const modelAny = params.model as any;
  const bindTools = params.bindTools ?? params.tools;
  const modelWithTools =
    bindTools.length > 0 && typeof modelAny.bindTools === 'function'
      ? modelAny.bindTools(bindTools)
      : params.model;

  const loopMessages: BaseMessage[] = [...params.messages];

  for (let step = 0; step < maxSteps; step++) {
    // AbortSignal 체크
    if (params.abortSignal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    params.cb?.onModelRun?.(step);

    // 실시간 스트리밍: .stream() 사용
    let accumulatedText = '';
    let accumulatedToolCallChunks: ToolCallChunk[] = [];
    let finalAiMessage: AIMessageChunk | null = null;

    try {
      const stream = await (modelWithTools as any).stream(loopMessages, {
        signal: params.abortSignal,
      });

      for await (const chunk of stream) {
        // AbortSignal 체크
        if (params.abortSignal?.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        // 텍스트 토큰 처리
        const textDelta = extractChunkContent(chunk);
        if (textDelta) {
          accumulatedText += textDelta;
          // 실시간으로 UI에 전달
          params.cb?.onToken?.(accumulatedText, textDelta);
        }

        // 도구 호출 청크 수집
        if (chunk.tool_call_chunks && Array.isArray(chunk.tool_call_chunks)) {
          accumulatedToolCallChunks.push(...chunk.tool_call_chunks);
        }

        // 최종 메시지 누적 (concat으로 병합)
        if (finalAiMessage === null) {
          finalAiMessage = chunk;
        } else {
          finalAiMessage = finalAiMessage.concat(chunk);
        }
      }
    } catch (e) {
      // 스트림 에러 처리
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw e;
      }
      // 네트워크 에러 등 - 부분 응답이 있으면 반환
      if (accumulatedText) {
        return { finalText: accumulatedText, usedTools: toolsUsed.length > 0, toolsUsed };
      }
      throw e;
    }

    // 최종 메시지를 대화 기록에 추가
    if (finalAiMessage) {
      loopMessages.push(finalAiMessage);
    }

    // OpenAI built-in tools 감지 (web_search_preview 등)
    const builtIns = detectOpenAiBuiltInToolsFromMessage(finalAiMessage, bindTools);
    for (const t of builtIns) {
      if (!toolsUsed.includes(t)) toolsUsed.push(t);
    }
    if (builtIns.length > 0) {
      console.info('[AI builtin_tools_used]', builtIns);
    }

    // 도구 호출 처리
    // 1) 스트리밍 청크에서 병합된 도구 호출
    let toolCalls = mergeToolCallChunks(accumulatedToolCallChunks);

    // 2) 최종 메시지에서 추출 (일부 모델은 스트리밍 중 tool_calls 대신 최종 메시지에만 포함)
    if (toolCalls.length === 0 && finalAiMessage) {
      toolCalls = extractToolCalls(finalAiMessage);
    }

    // 도구 호출이 없으면 최종 응답 반환
    if (toolCalls.length === 0) {
      return { finalText: accumulatedText, usedTools: toolsUsed.length > 0, toolsUsed };
    }

    // 도구 호출 실행
    for (const call of toolCalls) {
      const tool = toolMap.get(call.name);
      const toolCallId = getToolCallId(call);
      if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);
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
        // AbortSignal 체크
        if (params.abortSignal?.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        params.cb?.onToolCall?.({ phase: 'start', toolName: call.name, args: call.args });
        const out = await tool.invoke(call.args ?? {});

        // AbortSignal 체크 (tool 호출 후에도 체크)
        if (params.abortSignal?.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

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

function buildToolGuideMessage(params: { includeSource: boolean; includeTarget: boolean; provider: string; webSearchEnabled?: boolean; notionEnabled?: boolean; confluenceEnabled?: boolean }): SystemMessage {
  const { includeSource, includeTarget, provider } = params;
  // OpenAI와 Anthropic 모두 내장 웹 검색 지원
  const hasBuiltInWebSearch = provider === 'openai' || provider === 'anthropic';
  const webSearchEnabled = !!params.webSearchEnabled;
  const notionEnabled = !!params.notionEnabled;
  const confluenceEnabled = !!params.confluenceEnabled;
  const toolGuide = [
    '도구 사용 가이드:',
    '★ 도구를 적극적으로 활용하세요. 추측보다 도구 호출로 정확한 정보를 얻는 것이 좋습니다.',
    '',
    includeSource
      ? '- get_source_document: 원문 조회. 사용자가 문서 내용에 대해 질문하면 먼저 호출하세요.'
      : '- get_source_document: (비활성화됨)',
    includeTarget
      ? '- get_target_document: 번역문 조회. 번역 품질/표현에 대한 질문이면 먼저 호출하세요.'
      : '- get_target_document: (비활성화됨)',
    '- suggest_translation_rule: Translation Rules 저장 제안 생성(정의/구분은 tool description을 따른다)',
    '- suggest_project_context: Project Context 저장 제안 생성(정의/구분은 tool description을 따른다)',
    (webSearchEnabled && hasBuiltInWebSearch)
      ? '- 내장 웹 검색: 최신 정보/뉴스/기술 문서 등 웹 검색이 필요할 때 사용 (OpenAI: web_search_preview, Anthropic: web_search)'
      : '- 내장 웹 검색: (비활성화됨)',
    // Notion 도구 안내
    ...(notionEnabled
      ? [
        '- notion_search: Notion 워크스페이스에서 페이지/데이터베이스 검색. Notion 관련 정보가 필요할 때 사용.',
        '- notion_get_page: Notion 페이지 내용 조회. 검색 결과에서 특정 페이지의 내용을 읽을 때 사용.',
        '- notion_query_database: Notion 데이터베이스의 항목 조회.',
      ]
      : ['- notion_*: (비활성화됨)']),
    // Confluence 도구 안내
    confluenceEnabled
      ? '- confluence_*: Atlassian Confluence 페이지 검색/조회.'
      : '- confluence_*: (비활성화됨)',
    '',
    '도구 선택 우선순위 (위에서 아래로 평가):',
    '',
    '1. 부분 검토/질문 ("이 문장 맞아?", "이 표현 자연스러워?")',
    '   → get_source_document + get_target_document로 문서 조회 후 답변',
    '',
    webSearchEnabled
      ? '2. 최신 정보/실시간 데이터 필요 ("React 19 기능", "2025년 트렌드")\n   → 내장 웹 검색 사용'
      : '2. 최신 정보/실시간 데이터 필요\n   → (검색 비활성화됨)',
    '',
    notionEnabled
      ? '3. Notion 참조 필요\n   → notion_search로 검색 후, notion_get_page로 내용 조회'
      : '3. Notion 참조 필요\n   → (Notion 비활성화됨)',
    '',
    confluenceEnabled
      ? '4. Confluence 참조 필요\n   → confluence 도구 사용'
      : '4. Confluence 참조 필요\n   → (Confluence 비활성화됨)',
    '',
    '5. 문서 내용 필요 (문서 관련 질문이면 적극적으로 호출)',
    '   → get_source_document, get_target_document를 먼저 호출하여 근거 확보',
    '   → 문서가 길면 query/maxChars 파라미터로 필요한 부분만 조회',
    '',
    '6. 번역 스타일/포맷 규칙 발견',
    '   → suggest_translation_rule',
    '   → 응답: "[Add to Rules] 버튼을 눌러 추가하세요"',
    '',
    '7. 프로젝트 배경지식/맥락 정보 발견',
    '   → suggest_project_context',
    '   → 응답: "[Add to Context] 버튼을 눌러 추가하세요"',
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
  provider: string;
}): Promise<{ messages: BaseMessage[]; usedImages: boolean }> {
  const images = (params.imageAttachments ?? []).filter((x) => x && isImageExt(x.fileType) && !!x.filePath);
  if (images.length === 0) return { messages: params.messages, usedImages: false };
  if (!isTauriRuntime()) return { messages: params.messages, usedImages: false };

  const MAX_IMAGES = 10;
  const MAX_IMAGE_BYTES = 10_000_000; // 10MB

  const blocks: any[] = [{ type: 'text', text: params.userText }];
  const warnings: string[] = [];
  let usedImages = false;

  for (const img of images.slice(0, MAX_IMAGES)) {
    try {
      const raw = await readFileBytes(img.filePath);
      const bytes = new Uint8Array(raw);
      if (bytes.length > MAX_IMAGE_BYTES) {
        const sizeMB = (bytes.length / 1024 / 1024).toFixed(1);
        warnings.push(`- ${img.filename}: 파일이 너무 커서(${sizeMB}MB, 최대 10MB) 제외됨`);
        continue;
      }
      const base64 = bytesToBase64(bytes);
      // LangChain은 OpenAI/Anthropic 모두 image_url 형식을 받아서 내부적으로 변환함
      const ext = img.fileType.toLowerCase() === 'jpg' ? 'jpeg' : img.fileType.toLowerCase();
      const dataUrl = `data:image/${ext};base64,${base64}`;
      blocks.push({
        type: 'image_url',
        image_url: { url: dataUrl },
      });
      usedImages = true;
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

  if (!usedImages) {
    return { messages: params.messages, usedImages: false };
  }

  // buildLangChainMessages()가 만든 마지막 HumanMessage를 멀티모달 HumanMessage로 교체합니다.
  const next = [...params.messages];
  const lastIdx = next.length - 1;
  next[lastIdx] = new HumanMessage({ content: blocks });
  return { messages: next, usedImages };
}

function replaceLastHumanMessageText(messages: BaseMessage[], nextText: string): BaseMessage[] {
  const out = [...messages];
  const lastIdx = out.length - 1;
  out[lastIdx] = new HumanMessage(nextText);
  return out;
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
      ...(input.attachments ? { attachments: input.attachments } : {}),
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
  ];
  if (includeSource) toolSpecs.push(getSourceDocumentTool);
  if (includeTarget) toolSpecs.push(getTargetDocumentTool);

  // 내장 웹 검색 도구 (provider별 분기)
  function getBuiltInWebSearchTool(provider: string): Record<string, unknown>[] {
    if (provider === 'openai') {
      return [{ type: 'web_search_preview' }];
    }
    if (provider === 'anthropic') {
      return [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    }
    return [];
  }
  const openAiBuiltInTools = webSearchEnabled ? getBuiltInWebSearchTool(cfg.provider) : [];
  const bindTools = [...toolSpecs, ...openAiBuiltInTools];

  const messagesWithGuide: BaseMessage[] = [
    // systemPrompt에 가이드를 병합하여 하나의 SystemMessage만 유지
    new SystemMessage([
      (messages[0] as SystemMessage).content,
      '',
      buildToolGuideMessage({ includeSource, includeTarget, provider: cfg.provider, webSearchEnabled }).content,
    ].join('\n')),
    ...messages.slice(1),
  ];
  const { messages: finalMessages, usedImages } = await maybeReplaceLastHumanMessageWithImages({
    messages: messagesWithGuide,
    userText: input.userMessage,
    ...(input.imageAttachments ? { imageAttachments: input.imageAttachments } : {}),
    provider: cfg.provider,
  });

  let finalText: string;
  try {
    ({ finalText } = await runToolCallingLoop({
      model,
      tools: toolSpecs as any,
      bindTools,
      messages: finalMessages,
    }));
  } catch (e) {
    // 이미지 입력을 지원하지 않는 모델(OpenAI text-only 등)에서 400이 발생할 수 있어 폴백합니다.
    if (usedImages) {
      const fallback = replaceLastHumanMessageText(
        messagesWithGuide,
        [
          input.userMessage,
          '',
          '[첨부 이미지 안내]',
          '현재 선택된 모델/Provider에서 이미지 입력이 지원되지 않아, 이미지는 제외하고 진행합니다.',
          '이미지 분석이 필요하면 Vision 지원 모델로 변경해 주세요.',
        ].join('\n'),
      );
      ({ finalText } = await runToolCallingLoop({
        model,
        tools: toolSpecs as any,
        bindTools,
        messages: fallback,
      }));
    } else {
      throw e;
    }
  }

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
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      ...(targetDocument ? { targetDocument } : {}),
    },
    {
      ...(input.translatorPersona ? { translatorPersona: input.translatorPersona } : {}),
      requestType,
    },
  );

  // MCP 도구 (Atlassian Confluence)
  const mcpTools = input.confluenceSearchEnabled ? await mcpClientManager.getTools() : [];
  
  // Notion 도구 (REST API 기반)
  const notionTools = input.notionSearchEnabled ? await mcpClientManager.getNotionTools() : [];

  const toolSpecs: any[] = [
    suggestTranslationRule,
    suggestProjectContext,
    ...mcpTools,
    ...notionTools,
  ];
  if (includeSource) toolSpecs.push(getSourceDocumentTool);
  if (includeTarget) toolSpecs.push(getTargetDocumentTool);

  // 내장 웹 검색 도구 (provider별 분기)
  function getBuiltInWebSearchTool(provider: string): Record<string, unknown>[] {
    if (provider === 'openai') {
      return [{ type: 'web_search_preview' }];
    }
    if (provider === 'anthropic') {
      return [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    }
    return [];
  }
  const builtInWebSearchTools = webSearchEnabled
    ? getBuiltInWebSearchTool(cfg.provider)
    : [];

  // OpenAI 빌트인 커넥터 (Google, Dropbox, Microsoft 등) - OpenAI 전용
  const connectorTools = (cfg.provider === 'openai' && input.connectorConfigs && input.getConnectorToken)
    ? await buildConnectorTools(input.connectorConfigs, input.getConnectorToken)
    : [];
  
  const bindTools = [...toolSpecs, ...builtInWebSearchTools, ...connectorTools];

  const messagesWithGuide: BaseMessage[] = [
    // systemPrompt에 가이드를 병합하여 하나의 SystemMessage만 유지
    new SystemMessage([
      (messages[0] as SystemMessage).content,
      '',
      buildToolGuideMessage({
        includeSource,
        includeTarget,
        provider: cfg.provider,
        webSearchEnabled,
        notionEnabled: !!input.notionSearchEnabled,
        confluenceEnabled: !!input.confluenceSearchEnabled,
      }).content,
    ].join('\n')),
    ...messages.slice(1),
  ];
  const { messages: finalMessages, usedImages } = await maybeReplaceLastHumanMessageWithImages({
    messages: messagesWithGuide,
    userText: input.userMessage,
    ...(input.imageAttachments ? { imageAttachments: input.imageAttachments } : {}),
    provider: cfg.provider,
  });

  let finalText: string;
  let toolsUsed: string[];
  try {
    ({ finalText, toolsUsed } = await runToolCallingLoop({
      model,
      tools: toolSpecs as any,
      bindTools,
      messages: finalMessages,
      ...(cb ? { cb } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    }));
  } catch (e) {
    if (usedImages) {
      const fallback = replaceLastHumanMessageText(
        messagesWithGuide,
        [
          input.userMessage,
          '',
          '[첨부 이미지 안내]',
          '현재 선택된 모델/Provider에서 이미지 입력이 지원되지 않아, 이미지는 제외하고 진행합니다.',
          '이미지 분석이 필요하면 Vision 지원 모델로 변경해 주세요.',
        ].join('\n'),
      );
      ({ finalText, toolsUsed } = await runToolCallingLoop({
        model,
        tools: toolSpecs as any,
        bindTools,
        messages: fallback,
        ...(cb ? { cb } : {}),
      }));
    } else {
      throw e;
    }
  }

  cb?.onToolsUsed?.(toolsUsed);

  // 실시간 스트리밍: onToken 콜백은 runToolCallingLoop 내에서 이미 호출됨
  // 최종 텍스트만 반환
  return finalText;
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
