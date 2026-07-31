import type {
  ChatMessage,
  ChatSelectionSnapshot,
  ChatToolProfile,
  EditorBlock,
  ITEProject,
} from '@/types';
import type { ModelRunConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import { buildLangChainMessages, detectRequestType, type RequestType } from '@/ai/prompt';
import { getSourceDocumentTool, getTargetDocumentTool, getReviewResultsTool } from '@/ai/tools/documentTools';
import { suggestTranslationRule } from '@/ai/tools/suggestionTools';
import {
  confluenceGetPageTool,
  confluenceLoadPageTool,
  confluenceSearchTool,
} from '@/ai/tools/confluenceTools';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { BindToolsInput } from '@langchain/core/language_models/chat_models';
import type { ClientTool, ServerTool, StructuredToolInterface } from '@langchain/core/tools';
import { resolveModelCapabilities } from '@/ai/chatContext/modelCapabilities';
import { approxTokens } from '@/ai/chatContext/tokenBudget';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { resolveChatToolNames } from '@/ai/tools/resolveChatTools';
import { createSelectionTools } from '@/ai/tools/selectionTools';
import { createProjectGuidanceTools } from '@/ai/tools/projectGuidanceTools';
import {
  proposeProjectMemoryChange,
  proposeSelectionEdit,
  suggestForbiddenTerm,
  suggestGlossaryEntry,
} from '@/ai/tools/proposalTools';
import { useProjectMemoryStore } from '@/stores/projectMemoryStore';
import { useReviewStore } from '@/stores/reviewStore';
import { isTauriRuntime } from '@/tauri/invoke';
import { readFileBase64 } from '@/tauri/attachments';
import { runChatAgentStream } from '@/ai/chatAgent/runAgentStream';
import { recordAiUsage } from '@/ai/usageLedger';

import type { StreamCallbacks, UsageInfo } from '@/ai/chatAgent/types';

// 기존 import 경로(@/ai/chat)를 유지하기 위한 re-export
export type { StreamCallbacks, UsageInfo };


import { mcpClientManager } from '@/ai/mcp/McpClientManager';
import { buildConnectorTools, type ConnectorConfig } from '@/ai/connectors';

export interface GenerateReplyInput {
  project: ITEProject | null;
  contextBlocks: EditorBlock[];
  recentMessages: ChatMessage[];
  userMessage: string;
  /** 현재 selection scope의 선택 영역 snapshot */
  selection?: ChatSelectionSnapshot;
  selectionProposalEnabled?: boolean;
  toolProfile?: ChatToolProfile;
  /** 번역 규칙 (사용자 입력) */
  translationRules?: string;
  /** 글로서리 주입 결과(plain text) */
  glossaryInjected?: string;
  /** 승인된 Project Memory 압축 요약 */
  projectMemoryDigest?: string;
  /** 활성 금칙어 목록 */
  forbiddenTermsDigest?: string;
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
  /**
   * 장기 대화 누적 요약 (Phase 3).
   * - store의 context planner가 오래된 대화를 접어 만든 요약. recentMessages(원문)와 함께 전달.
   */
  conversationSummary?: string;
}

// 내장 웹 검색 도구 (provider별 분기) - 공통 함수로 추출
function getBuiltInWebSearchTool(provider: string): Record<string, unknown>[] {
  if (provider === 'openai') {
    return [{ type: 'web_search_preview' }];
  }
  if (provider === 'anthropic') {
    return [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }
  return [];
}

/**
 * Phase 3.1: 도구 스펙 빌더 공통 함수
 * 스트리밍/비스트리밍 모두에서 동일한 도구를 사용하도록 통합
 */
interface BuildToolSpecsInput {
  profile: ChatToolProfile;
  project: ITEProject | null;
  selection?: ChatSelectionSnapshot | undefined;
  selectionProposalEnabled?: boolean | undefined;
  userMessage: string;
  translationRules?: string | undefined;
  webSearchEnabled: boolean;
  confluenceSearchEnabled: boolean;
  connectorConfigs?: ConnectorConfig[] | undefined;
  getConnectorToken?: ((connectorId: string) => Promise<string | null>) | undefined;
  provider: string;
}

interface BuildToolSpecsResult {
  /** 모델에 바인딩할 도구 전체 (로컬 실행 도구 + provider 빌트인/커넥터 도구) */
  bindTools: BindToolsInput[];
  boundToolNames: string[];
}

async function buildToolSpecs(input: BuildToolSpecsInput): Promise<BuildToolSpecsResult> {
  const memoryState = useProjectMemoryStore.getState();
  // 도구 목록은 프로필과 설정(웹/Confluence 토글)으로만 정한다.
  // 사용자 메시지 정규식으로 도구를 켜고 끄면 tools 블록이 매 턴 달라져
  // 그 뒤의 system·대화 이력 캐시가 통째로 무효화된다.
  const allowedNames = new Set(resolveChatToolNames({
    profile: input.profile,
    hasProject: !!input.project,
    hasSourceSelection: input.selection?.panel === 'source',
    hasTargetSelection: input.selection?.panel === 'target',
    hasReviewResults: useReviewStore.getState().results.length > 0,
    webEnabled: input.webSearchEnabled,
    confluenceEnabled: input.confluenceSearchEnabled,
  }));
  if (!input.selectionProposalEnabled) {
    allowedNames.delete('propose_selection_edit');
  }

  const candidates: StructuredToolInterface[] = [
    getSourceDocumentTool,
    getTargetDocumentTool,
    getReviewResultsTool,
    suggestTranslationRule,
    proposeProjectMemoryChange,
    suggestForbiddenTerm,
    suggestGlossaryEntry,
  ];
  if (input.selection) {
    candidates.push(...createSelectionTools(input.selection));
    if (input.selection.panel === 'target') candidates.push(proposeSelectionEdit);
  }
  if (input.project) {
    candidates.push(...createProjectGuidanceTools({
      projectId: input.project.id,
      domain: input.project.metadata.domain,
      translationRules: input.translationRules ?? '',
      projectMemoryItems: memoryState.items,
      forbiddenTerms: memoryState.forbiddenTerms,
    }));
  }
  const toolSpecs = candidates.filter((candidate) => allowedNames.has(candidate.name));

  // Confluence 도구 (Atlassian MCP를 Tauri command로 직접 호출하는 로컬 래퍼)
  //
  // 미연결 상태에서는 아예 바인딩하지 않는다. 붙여도 첫 호출이 mcp_call_tool에서 실패해
  // 모델 왕복만 버리고, 쓸 수 없는 도구 스펙 토큰이 매 요청 실린다.
  //
  // 서버가 주는 MCP 도구를 그대로 바인딩하지는 않는다 — 이름이 registry에 없어 어차피
  // allowedNames에서 전량 탈락하고, 서버 설명이 장문이라 tools 프리픽스만 커진다.
  if (input.confluenceSearchEnabled && mcpClientManager.getStatus().isConnected) {
    for (const confluenceTool of [confluenceSearchTool, confluenceGetPageTool, confluenceLoadPageTool]) {
      if (allowedNames.has(confluenceTool.name)) toolSpecs.push(confluenceTool);
    }
  }

  // 내장 웹 검색 도구
  const builtInWebSearchTools = allowedNames.has('web_search')
    ? getBuiltInWebSearchTool(input.provider)
    : [];

  // OpenAI 빌트인 커넥터 (Google, Dropbox, Microsoft 등) - OpenAI 전용.
  // 사용자가 설정한 커넥터 목록에만 의존하므로 세션 내내 동일하다.
  const connectorTools = (
    input.profile === 'general'
    && input.provider === 'openai'
    && input.connectorConfigs
    && input.getConnectorToken
  )
    ? await buildConnectorTools(input.connectorConfigs, input.getConnectorToken)
    : [];

  const bindTools: BindToolsInput[] = [...toolSpecs, ...builtInWebSearchTools, ...connectorTools];

  // 바인딩된 도구 이름 목록 (동적 가이드 생성용)
  const boundToolNames = toolSpecs.map((t) => t.name);

  // 웹 검색이 활성화되면 가상 이름 추가
  if (allowedNames.has('web_search') && (input.provider === 'openai' || input.provider === 'anthropic')) {
    boundToolNames.push('web_search');
  }

  return { bindTools, boundToolNames };
}

/**
 * Phase 3.2: 실제 바인딩된 도구 기반으로 가이드 동적 생성
 */
function buildToolGuideMessage(params: {
  boundToolNames: string[];
  provider: string;
}): SystemMessage {
  const { boundToolNames, provider } = params;
  const has = (name: string) => boundToolNames.includes(name);

  const toolGuide: string[] = [
    '도구 사용 가이드:',
    '★ 도구를 적극적으로 활용하세요. 추측보다 도구 호출로 정확한 정보를 얻는 것이 좋습니다.',
    '',
  ];

  // 문서 도구
  if (has('get_source_document')) {
    toolGuide.push('- get_source_document: 원문 조회. 사용자가 문서 내용에 대해 질문하면 먼저 호출하세요.');
  }
  if (has('get_target_document')) {
    toolGuide.push('- get_target_document: 번역문 조회. 번역 품질/표현에 대한 질문이면 먼저 호출하세요.');
  }
  if (has('get_selection_surroundings')) {
    toolGuide.push('- get_selection_surroundings: 선택 영역만으로 부족할 때 앞뒤 문맥을 제한적으로 조회.');
  }
  if (has('get_aligned_selection_context')) {
    toolGuide.push('- get_aligned_selection_context: 선택 구간의 원문↔번역문 대조가 필요할 때 조회(Source 선택에서 번역 결과를 물어도 이 도구를 쓴다).');
  }
  if (has('get_project_guidance')) {
    toolGuide.push('- get_project_guidance: [프로젝트 메모리] 요약에 없는 규칙·금칙어·메모리 상세가 필요할 때 조회.');
  }
  if (has('search_project_glossary')) {
    toolGuide.push('- search_project_glossary: 현재 질문에 관련된 용어만 검색.');
  }
  if (has('propose_selection_edit')) {
    toolGuide.push('- propose_selection_edit: Target 선택 수정안을 구조화해 제안. 문서를 직접 변경하지 않음.');
  }
  // 저장 제안 도구 — 도구별 설명을 늘어놓는 대신 "무엇을 어디에"를 한 곳에 모은다.
  // 잘못 고르면 비용이 여기서 끝나지 않는다: 용어집·금칙어는 구조화 저장이라 문서에
  // 나올 때만 실리지만, 규칙·메모리는 블롭이라 이후 모든 번역·검수에 전량 실린다.
  const knowledgeProposalTools = [
    'suggest_glossary_entry',
    'suggest_forbidden_term',
    'suggest_translation_rule',
    'propose_project_memory_change',
  ].filter(has);
  if (knowledgeProposalTools.length > 0) {
    toolGuide.push('- 저장 제안 도구 — 넣을 곳을 먼저 고르세요(모두 제안만 하며, 사용자가 승인해야 저장됩니다):');
    if (has('suggest_glossary_entry')) {
      toolGuide.push('  · 원문 A를 번역 B로 고정 → suggest_glossary_entry');
    }
    if (has('suggest_forbidden_term')) {
      toolGuide.push('  · 번역문에 쓰면 안 되는 표현 → suggest_forbidden_term');
    }
    if (has('suggest_translation_rule')) {
      toolGuide.push('  · 문체·서식·표기 규칙 → suggest_translation_rule');
    }
    if (has('propose_project_memory_change')) {
      toolGuide.push('  · 제품·독자·세계관 같은 배경 사실 → propose_project_memory_change');
    }
    toolGuide.push('  · 사용자가 명시적으로 요청했거나 대화에서 합의된 내용만 제안하세요. 추측으로 제안하지 마세요.');
  }
  // 웹 검색
  if (has('web_search')) {
    const providerHint = provider === 'openai' ? 'web_search_preview' : 'web_search';
    toolGuide.push(`- 내장 웹 검색: 최신 정보/뉴스/기술 문서 등 웹 검색이 필요할 때 사용 (${providerHint})`);
  }

  // Confluence 도구
  if (has('confluence_search')) {
    toolGuide.push('- confluence_search: 사내 Confluence 위키 검색. 사내 용례·표기·참고 문서를 찾을 때 사용.');
  }
  if (has('confluence_get_page')) {
    toolGuide.push('- confluence_get_page: Confluence 페이지 URL의 본문을 읽는다(읽기 전용). 검색 결과 URL도 그대로 넘길 수 있다.');
  }
  if (has('confluence_load_page')) {
    toolGuide.push('- confluence_load_page: Confluence 페이지를 원문 에디터에 로드. 원문 문서를 덮어쓰므로 번역을 시작할 때만 사용.');
  }

  toolGuide.push('', '도구 선택 우선순위 (위에서 아래로 평가):', '');

  // 우선순위 가이드 (바인딩된 도구에 따라 동적 생성)
  let priority = 1;

  if (has('get_source_document') || has('get_target_document')) {
    toolGuide.push(`${priority}. 부분 검토/질문 ("이 문장 맞아?", "이 표현 자연스러워?")`);
    toolGuide.push('   → get_source_document + get_target_document로 문서 조회 후 답변');
    toolGuide.push('');
    priority++;
  }

  // 사내 표기·용례는 공개 웹보다 사내 위키가 먼저다.
  if (has('confluence_search') || has('confluence_get_page')) {
    toolGuide.push(`${priority}. 사내 문서 근거 필요 ("우리는 이 용어 뭐라고 쓰지?", "이 페이지 뭐라고 써있어?")`);
    if (has('confluence_search')) {
      toolGuide.push('   → confluence_search로 관련 페이지를 찾고, 필요하면 confluence_get_page로 본문 확인');
    }
    if (has('confluence_get_page')) {
      toolGuide.push('   → 사용자가 Confluence URL을 주면 곧바로 confluence_get_page');
    }
    toolGuide.push('');
    priority++;
  }

  if (has('web_search')) {
    toolGuide.push(`${priority}. 최신 정보/실시간 데이터 필요 ("React 19 기능", "2025년 트렌드")`);
    toolGuide.push('   → 내장 웹 검색 사용');
    toolGuide.push('');
    priority++;
  }

  if (has('get_source_document') || has('get_target_document')) {
    toolGuide.push(`${priority}. 문서 내용 필요 (문서 관련 질문이면 적극적으로 호출)`);
    toolGuide.push('   → get_source_document, get_target_document를 먼저 호출하여 근거 확보');
    toolGuide.push('   → 문서가 길면 query/maxChars 파라미터로 필요한 부분만 조회');
    toolGuide.push('');
    priority++;
  }

  if (knowledgeProposalTools.length > 0) {
    toolGuide.push(`${priority}. 다음 작업에도 남길 지식이 확인됨 (용어·금칙어·규칙·배경 사실)`);
    toolGuide.push('   → 위 "저장 제안 도구"의 분류에 맞는 도구를 호출');
    toolGuide.push('   → 응답: 저장됐다고 말하지 말고 승인 버튼을 안내');
    toolGuide.push('');
    priority++;
  }

  return new SystemMessage(toolGuide.join('\n'));
}

function isImageExt(ext: string): boolean {
  const e = (ext ?? '').toLowerCase();
  return e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'webp' || e === 'gif';
}

async function maybeReplaceLastHumanMessageWithImages(params: {
  messages: BaseMessage[];
  userText: string;
  imageAttachments?: { filename: string; fileType: string; filePath: string; thumbnailDataUrl?: string }[];
  provider: string;
}): Promise<{ messages: BaseMessage[]; usedImages: boolean }> {
  const images = (params.imageAttachments ?? []).filter(
    (x) => x && isImageExt(x.fileType) && (!!x.thumbnailDataUrl || !!x.filePath)
  );
  if (images.length === 0) return { messages: params.messages, usedImages: false };

  const MAX_IMAGES = 10;
  // 프로바이더별 크기 제한 (base64 인코딩 전 기준)
  const isAnthropic = params.provider === 'anthropic';
  const MAX_IMAGE_BYTES = isAnthropic ? 5_000_000 : 20_000_000; // Anthropic: 5MB, OpenAI: 20MB
  const providerName = isAnthropic ? 'Claude' : 'OpenAI';

  const blocks: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: params.userText }];
  const warnings: string[] = [];
  let usedImages = false;

  for (const img of images.slice(0, MAX_IMAGES)) {
    try {
      let dataUrl: string;

      // thumbnailDataUrl이 있으면 사용 (이미 리사이즈됨)
      if (img.thumbnailDataUrl) {
        dataUrl = img.thumbnailDataUrl;
      } else if (img.filePath && isTauriRuntime()) {
        // 없으면 원본 파일을 base64로 읽음 (number[] JSON IPC 회피, P5)
        const base64 = await readFileBase64(img.filePath);
        const approxBytes = Math.ceil((base64.length * 3) / 4);
        if (approxBytes > MAX_IMAGE_BYTES) {
          const sizeMB = (approxBytes / 1024 / 1024).toFixed(1);
          const limitMB = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
          warnings.push(`- ${img.filename}: 파일이 너무 커서(${sizeMB}MB, ${providerName} 최대 ${limitMB}MB) 제외됨`);
          continue;
        }
        const ext = img.fileType.toLowerCase() === 'jpg' ? 'jpeg' : img.fileType.toLowerCase();
        dataUrl = `data:image/${ext};base64,${base64}`;
      } else {
        warnings.push(`- ${img.filename}: 이미지를 읽을 수 없어 제외됨`);
        continue;
      }

      // data URL 크기 검증 (base64는 원본의 약 4/3)
      const base64Part = dataUrl.split(',')[1];
      const estimatedBytes = base64Part ? Math.ceil((base64Part.length * 3) / 4) : 0;
      if (estimatedBytes > MAX_IMAGE_BYTES) {
        const sizeMB = (estimatedBytes / 1024 / 1024).toFixed(1);
        const limitMB = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
        warnings.push(`- ${img.filename}: 이미지가 너무 커서(${sizeMB}MB, ${providerName} 최대 ${limitMB}MB) 제외됨`);
        continue;
      }

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
 * AI 응답 생성 (streaming)
 */
export async function streamAssistantReply(
  input: GenerateReplyInput,
  runConfig: ModelRunConfig,
  cb?: StreamCallbacks,
): Promise<string> {
  if (runConfig.provider === 'mock') {
    const mock = getMockResponse(input);
    cb?.onToken?.(mock, mock);
    return mock;
  }

  // 요청 유형 자동 감지
  const requestType = input.requestType ?? detectRequestType(input.userMessage);

  // 캡처된 runConfig로 모델 생성 (요청 도중 전역 store 재조회 없음 → 모델 결정 경쟁 조건 제거)
  const model = createChatModel(undefined, { useFor: 'chat', runConfig });

  // Phase 3: 대상 모델 capability (입력 예산/vision 지원)
  const capabilities = resolveModelCapabilities(runConfig);

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
      ...(input.selection ? { selection: input.selection } : {}),
      ...(input.translationRules ? { translationRules: input.translationRules } : {}),
      ...(input.glossaryInjected ? { glossaryInjected: input.glossaryInjected } : {}),
      ...(input.projectMemoryDigest ? { projectMemoryDigest: input.projectMemoryDigest } : {}),
      ...(input.forbiddenTermsDigest ? { forbiddenTermsDigest: input.forbiddenTermsDigest } : {}),
      ...(input.conversationSummary ? { conversationSummary: input.conversationSummary } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(sourceDocument ? { sourceDocument } : {}),
      ...(targetDocument ? { targetDocument } : {}),
    },
    {
      requestType,
      imageInputs: capabilities.imageInputs,
    },
  );

  // Phase 3.1: 공통 도구 빌더 사용 (스트리밍/비스트리밍 통합)
  const { bindTools, boundToolNames } = await buildToolSpecs({
    profile: input.toolProfile ?? (
      input.selection?.panel === 'source'
        ? 'selection-source'
        : input.selection?.panel === 'target'
          ? 'selection-target'
          : 'general'
    ),
    project: input.project,
    selection: input.selection,
    selectionProposalEnabled: input.selectionProposalEnabled,
    userMessage: input.userMessage,
    translationRules: input.translationRules,
    webSearchEnabled: !!input.webSearchEnabled,
    confluenceSearchEnabled: !!input.confluenceSearchEnabled,
    connectorConfigs: input.connectorConfigs,
    getConnectorToken: input.getConnectorToken,
    provider: runConfig.provider,
  });

  // Phase 3.2: 동적 가이드 생성
  const basePrompt = String((messages[0] as SystemMessage).content);
  const toolGuide = String(
    buildToolGuideMessage({ boundToolNames, provider: runConfig.provider }).content,
  );
  const messagesWithGuide: BaseMessage[] = [
    // systemPrompt에 가이드를 병합하여 하나의 SystemMessage만 유지
    new SystemMessage([basePrompt, '', toolGuide].join('\n')),
    ...messages.slice(1),
  ];

  // 프롬프트 구성 관측. "짧은 질문인데 왜 입력 토큰이 많은가"를 추정 없이 답하기 위해
  // 프리픽스를 구성요소별로 찍는다. 문자열 길이만 재므로 비용은 사실상 0이다.
  // (CJK 1자 ≈ 1토큰, ASCII 4자 ≈ 1토큰 — approxTokens와 동일 기준)
  //
  // 도구는 Zod 스키마를 JSON Schema로 변환한 뒤 잰다. Zod 객체를 그대로 stringify하면
  // 실제 전송 페이로드보다 훨씬 작게 나와 진단이 틀린다.
  const toolSizes = bindTools.map((t) => {
    const spec = t as { name?: string; description?: string; schema?: unknown; type?: string };
    let schemaText = '';
    try {
      schemaText = spec.schema ? JSON.stringify(toJsonSchema(spec.schema as never)) : JSON.stringify(t);
    } catch {
      schemaText = JSON.stringify(t);
    }
    return {
      name: spec.name ?? spec.type ?? 'unknown',
      tokens: approxTokens(`${spec.name ?? ''}\n${spec.description ?? ''}\n${schemaText}`),
    };
  });
  const toolDefsTotal = toolSizes.reduce((sum, x) => sum + x.tokens, 0);
  const historyTokens = approxTokens(
    messages.slice(1, -1).map((m) => String(m.content)).join('\n'),
  );
  const currentTurnTokens = approxTokens(String(messages[messages.length - 1]?.content ?? ''));

  // 콘솔이 객체를 접어서 필드가 잘리는 것을 피하려고 한 줄 문자열로 찍는다.
  console.warn(
    `[AI prompt] system=${approxTokens(basePrompt)} guide=${approxTokens(toolGuide)} ` +
      `tools=${toolDefsTotal}(${bindTools.length}개) history=${historyTokens}(${Math.max(0, messages.length - 2)}건) ` +
      `turn=${currentTurnTokens} | 합계≈${approxTokens(basePrompt) + approxTokens(toolGuide) + toolDefsTotal + historyTokens + currentTurnTokens}`,
  );
  console.warn(
    '[AI prompt tools] ' +
      toolSizes
        .sort((a, b) => b.tokens - a.tokens)
        .map((x) => `${x.name}=${x.tokens}`)
        .join(' '),
  );
  const { messages: finalMessages, usedImages } = await maybeReplaceLastHumanMessageWithImages({
    messages: messagesWithGuide,
    userText: input.userMessage,
    ...(input.imageAttachments ? { imageAttachments: input.imageAttachments } : {}),
    provider: runConfig.provider,
  });

  // 시스템 메시지는 에이전트의 systemPrompt로 분리해서 넘긴다.
  // (createAgent가 매 스텝 앞에 붙이며, prompt cache breakpoint도 여기에 찍힌다)
  const runAgent = (messages: BaseMessage[]) =>
    runChatAgentStream({
      model,
      tools: bindTools as (ClientTool | ServerTool)[],
      systemPrompt: messages[0] as SystemMessage,
      messages: messages.slice(1),
      provider: runConfig.provider,
      capabilities,
      ...(cb ? { cb } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      maxSteps: input.selection ? 4 : 6,
    });

  let finalText: string;
  let toolsUsed: string[];
  let usage: UsageInfo;
  try {
    ({ finalText, toolsUsed, usage } = await runAgent(finalMessages));
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
      ({ finalText, toolsUsed, usage } = await runAgent(fallback));
    } else {
      throw e;
    }
  }

  cb?.onToolsUsed?.(toolsUsed);
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined || usage.totalTokens !== undefined) {
    cb?.onUsage?.(usage);
  }
  // 사용량 장부: 도구 루프 전체를 1건으로 남긴다(modelCalls로 스텝 수를 보존).
  recordAiUsage({
    feature: 'chat',
    provider: runConfig.provider,
    model: runConfig.resolvedModel,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    modelCalls: usage.modelCalls,
  });
  // prompt caching 실효 관측.
  // usage가 있으면 항상 찍는다. 종전에는 cache_read > 0일 때만 기록해서, 정작 진단하려던
  // "캐시가 한 번도 안 맞는 상태"에서 아무 로그도 남지 않았다.
  // - read가 0이면 프리픽스를 매번 깨뜨리는 요소를 의심할 것
  // - read가 'n/a'면 provider/SDK가 캐시 정보를 보고하지 않는 것 (별개 원인)
  if (usage.inputTokens !== undefined) {
    const calls = usage.modelCalls ?? 1;
    console.warn('[AI cache]', {
      read: usage.cacheReadInputTokens ?? 'n/a',
      write: usage.cacheCreationInputTokens ?? 'n/a',
      input: usage.inputTokens,
      lastInput: usage.lastInputTokens ?? 'n/a',
      modelCalls: calls,
      inputPerCall: Math.round(usage.inputTokens / Math.max(1, calls)),
    });
  }

  // 실시간 스트리밍: onToken 콜백은 runChatAgentStream 내에서 이미 호출됨
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
