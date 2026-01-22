import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { stripHtml } from '@/utils/hash';

// ============================================
// 요청 유형 정의
// ============================================

export type RequestType = 'translate' | 'question' | 'general';

// 토큰(문자) 최적화용 상한. GPT-5 시리즈 400k 컨텍스트 윈도우 기준으로 여유 있게 설정.
const LIMITS = {
  translationRulesChars: 10000,
  projectContextChars: 30000,
  glossaryChars: 30000,
  documentChars: 100000,
  attachmentCharsPerFile: 30000,
  attachmentCharsTotal: 100000,
  blockContextMaxBlocks: 20,
  blockContextCharsPerBlock: 500,
} as const;

/**
 * 사용자 메시지에서 요청 유형을 감지
 * - 번역 요청: "번역", "translate", "~로 옮겨", "~로 바꿔" 등
 * - 질문 요청: "?", "무엇", "왜", "어떻게", "뭐야", "알려줘" 등
 */
export function detectRequestType(message: string): RequestType {
  const lowerMessage = message.toLowerCase();

  // Priority 1: Explicit question markers (high confidence)
  if (message.includes('?') || message.includes('？')) {
    return 'question';
  }

  // Priority 2: Strong translation commands (exact matches for Korean verb endings)
  const strongTranslate = ['번역해', '번역해줘', '옮겨줘', '바꿔줘'];
  if (strongTranslate.some(cmd => lowerMessage.includes(cmd))) {
    return 'translate';
  }

  // Priority 3: Question words with word boundary checking
  // For Korean single-syllable words, check they're not inside other words
  const shortKoreanWords = ['뭐', '맞아', '틀려', '어때'];
  for (const word of shortKoreanWords) {
    // Check if word appears with space/punctuation around it
    const hasWordBoundary =
      lowerMessage.startsWith(word) ||
      lowerMessage.includes(` ${word}`) ||
      lowerMessage.includes(`\n${word}`) ||
      lowerMessage.endsWith(word);
    if (hasWordBoundary) {
      return 'question';
    }
  }

  // Regular question indicators
  const questionIndicators = [
    '무엇', '왜', '어떻게', '어디', '언제', '누가',
    '알려줘', '알려', '설명해', '의미', '뜻이', '차이', '맞나', '인가',
    'how ', 'what ', 'why ', 'where ', 'when ', 'who ', 'check', 'correct', 'wrong'
  ];

  for (const indicator of questionIndicators) {
    if (lowerMessage.includes(indicator)) {
      return 'question';
    }
  }

  // Priority 4: Weak translation indicators
  const translateKeywords = [
    'translate', '변환', '한국어로', '영어로',
    '일본어로', '중국어로', '다듬어', '수정해', '고쳐', '옮겨', '바꿔'
  ];

  for (const keyword of translateKeywords) {
    if (lowerMessage.includes(keyword)) {
      return 'translate';
    }
  }

  return 'general';
}

// ============================================
// 프롬프트 컨텍스트 인터페이스
// ============================================

export interface PromptContext {
  project: ITEProject | null;
  contextBlocks: EditorBlock[];
  recentMessages: ChatMessage[];
  userMessage: string;
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
  /** 첨부 파일 (추출된 텍스트 목록) */
  attachments?: { filename: string; text: string }[];
}

export interface PromptOptions {
  /** 사용자 정의 번역기 페르소나 */
  translatorPersona?: string;
  /** 요청 유형 (자동 감지 또는 명시적 지정) */
  requestType?: RequestType;
}

// ============================================
// 시스템 프롬프트 빌더
// ============================================

function buildBaseSystemPrompt(project: ITEProject | null, persona?: string): string {
  const domain = project?.metadata.domain ?? 'general';
  const src = 'Source';
  const tgt = project?.metadata.targetLanguage ?? 'Target';

  // 사용자가 Persona를 설정했으면 그것을 사용, 아니면 기본값
  const personaBlock = persona?.trim()
    ? persona
    : '당신은 경험많은 전문 번역가입니다.';

  return [
    personaBlock,
    '',
    `프로젝트: ${domain}`,
    `언어: ${src} → ${tgt}`,
    '',
    '핵심 원칙:',
    '- 번역사가 주도권을 가지고, AI는 요청 시에만 응답합니다.',
    '- 불필요한 설명, 인사, 부연 없이 핵심만 답합니다.',
    '- 확신 없는 내용은 추측하지 않고 확인 질문을 먼저 합니다.',
  ].join('\n');
}

function buildTranslateSystemPrompt(project: ITEProject | null, opts?: PromptOptions): string {
  // 번역 모드: 사용자 Persona 반영
  const base = buildBaseSystemPrompt(project, opts?.translatorPersona);

  return [
    base,
    '',
    '=== 번역 요청 모드 ===',
    '중요: 번역문만 출력하세요.',
    '- 설명, 인사, 부연, 마크다운 없이 오직 번역 결과만 응답합니다.',
    '- "번역 결과입니다", "다음과 같이 번역했습니다" 등의 사족을 붙이지 마세요.',
    '- 고유명사, 태그, 변수는 그대로 유지합니다.',
  ].join('\n');
}

function buildQuestionSystemPrompt(project: ITEProject | null, opts?: PromptOptions): string {
  // 질문 모드: Persona 무시 (Systemically Controlled) - 기본 '전문 번역가' 페르소나 유지
  // 단, 사용자가 설정한 Persona가 있다면 '컨텍스트'로만 제공하여 번역 방향성을 참고하게 함 (행동 지침 X)
  const base = buildBaseSystemPrompt(project, undefined);
  const personaContext = opts?.translatorPersona?.trim()
    ? `\n[참고: 사용자가 설정한 번역 페르소나]\n${opts.translatorPersona}\n(이 페르소나는 번역 작업 시 적용됩니다. 질문 답변 시에는 참고만 하세요.)`
    : '';

  return [
    base,
    personaContext,
    '',
    '=== 질문 응답 모드 ===',
    '- 질문에 간결하게 답변합니다.',
    '- 문서 관련 질문이면 추측하지 말고 먼저 get_source_document / get_target_document를 호출하여 정확한 근거를 확보하세요.',
    '- 필요한 경우에만 예시를 들어 설명합니다.',
    '- suggest_translation_rule / suggest_project_context 도구의 정의/구분은 tool description을 따른다.',
    '- suggest_* 도구는 "저장 제안" 생성일 뿐이며, 실제 저장/반영은 사용자가 버튼을 눌러야만 가능합니다.',
    '- 응답에서 "저장/추가 완료"라고 말하지 말고, 필요 시 "원하시면 [Add to Rules] 버튼을 눌러 추가하세요" 또는 "원하시면 [Add to Context] 버튼을 눌러 추가하세요"라고 안내합니다.',
    '',
    '문서 대조/검수 지침:',
    '- 사용자가 "번역 맞아?", "고유명사/기관명 제대로 번역됐어?", "누락/오역 확인"처럼 원문↔번역문 대조가 필요한 요청을 하면, 사용자가 문서를 붙여주길 기다리기 전에 먼저 get_source_document / get_target_document를 호출해 필요한 근거를 확보합니다.',
    '- 문서가 길면 query/maxChars를 사용해 필요한 구간만 가져오고, 그래도 부족할 때만 "검수할 구간을 선택해 달라"는 확인 요청을 0~1개 합니다.',
    '',
    '채팅에서 가능한 것:',
    '- 부분 번역: 특정 문장, 단락, 선택 영역의 번역 요청',
    '- 여러 버전 제안: "A안/B안", "격식체/비격식체", "직역/의역" 등 대안 제시',
    '- 부분 검수: 특정 구간의 오역/누락/왜곡 검토',
    '- 번역 개선: 특정 문장의 다듬기, 자연스러운 표현 제안',
    '- 전체 문서 번역: 문서 전체 번역 요청도 처리 가능',
    '- 전체 문서 검수: 문서 전체 검수 요청도 처리 가능',
    '',
    '출력 포맷:',
    '- 간결하게 작성하고, 필요 시 불릿/리스트/강조(볼드/이탤릭)를 사용할 수 있습니다.',
  ].join('\n');
}

function buildGeneralSystemPrompt(project: ITEProject | null, _opts?: PromptOptions): string {
  // 일반 모드도 질문 모드와 동일하게 처리
  const base = buildBaseSystemPrompt(project, undefined);
  return base;
}

// ============================================
// 컨텍스트 포매터
// ============================================

function formatTranslationRules(rules?: string): string {
  const trimmed = rules?.trim();
  if (!trimmed) return '';
  const maxLen = LIMITS.translationRulesChars;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  return ['[번역 규칙]', sliced].join('\n');
}

function formatProjectContext(context?: string): string {
  const trimmed = context?.trim();
  if (!trimmed) return '';
  const maxLen = LIMITS.projectContextChars;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  return ['[Project Context]', sliced].join('\n');
}

function formatGlossaryInjected(glossary?: string): string {
  const trimmed = glossary?.trim();
  if (!trimmed) return '';
  const maxLen = LIMITS.glossaryChars;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  return ['[글로서리(주입)]', sliced].join('\n');
}

function formatDocument(label: string, text?: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  const maxLen = LIMITS.documentChars;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  return [`[${label}]`, sliced].join('\n');
}

function formatAttachments(attachments?: { filename: string; text: string }[]): string {
  if (!attachments || attachments.length === 0) return '';

  const lines: string[] = ['[첨부 파일]'];
  const maxLenPerFile = LIMITS.attachmentCharsPerFile;
  const totalMaxLen = LIMITS.attachmentCharsTotal;
  let currentTotal = 0;

  for (const att of attachments) {
    if (currentTotal >= totalMaxLen) break;

    const trimmed = att.text.trim();
    if (!trimmed) continue;

    const available = totalMaxLen - currentTotal;
    const sliceLen = Math.min(trimmed.length, maxLenPerFile, available);

    const sliced = trimmed.length > sliceLen ? `${trimmed.slice(0, sliceLen)}...` : trimmed;

    lines.push(`--- [파일: ${att.filename}] ---`);
    lines.push(sliced);
    lines.push('');

    currentTotal += sliced.length;
  }

  return lines.join('\n');
}

export function buildBlockContextText(blocks: EditorBlock[]): string {
  if (blocks.length === 0) return '';

  const lines: string[] = ['[컨텍스트 블록]'];
  for (const b of blocks.slice(0, LIMITS.blockContextMaxBlocks)) {
    const plain = stripHtml(b.content);
    const sliced = plain.length > LIMITS.blockContextCharsPerBlock 
      ? `${plain.slice(0, LIMITS.blockContextCharsPerBlock)}...` 
      : plain;
    // 타입 라벨은 토큰 대비 정보량이 낮아 최소화
    lines.push(`- ${sliced}`);
  }
  return lines.join('\n');
}

// ============================================
// 레거시 호환용 (기존 코드 호환)
// ============================================

export function buildSystemPrompt(project: ITEProject | null, opts?: PromptOptions): string {
  return buildGeneralSystemPrompt(project, opts);
}

// ============================================
// 메시지 히스토리 변환
// ============================================

/** 최근 N개 메시지까지 이미지 포함 (토큰 비용 제한) */
const MAX_HISTORY_IMAGES_MESSAGES = 3;

function mapRecentMessagesToHistory(recentMessages: ChatMessage[]): BaseMessage[] {
  const history: BaseMessage[] = [];
  const totalMessages = recentMessages.length;

  recentMessages.forEach((m, i) => {
    const isRecent = i >= totalMessages - MAX_HISTORY_IMAGES_MESSAGES;

    if (m.role === 'user') {
      const images = isRecent ? (m.metadata?.imageAttachments ?? []) : [];

      if (images.length > 0 && images.some((img) => img.thumbnailDataUrl)) {
        // 멀티모달 HumanMessage: 텍스트 + 이미지
        const blocks: Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        > = [{ type: 'text', text: m.content }];

        for (const img of images) {
          if (img.thumbnailDataUrl) {
            blocks.push({
              type: 'image_url',
              image_url: { url: img.thumbnailDataUrl },
            });
          }
        }
        history.push(new HumanMessage({ content: blocks }));
      } else {
        history.push(new HumanMessage(m.content));
      }
    } else if (m.role === 'assistant') {
      history.push(new AIMessage(m.content));
    }
  });

  return history;
}

// ============================================
// LangChain 메시지 빌더
// ============================================

export async function buildLangChainMessages(
  ctx: PromptContext,
  opts?: PromptOptions,
): Promise<BaseMessage[]> {
  // 요청 유형 감지
  const requestType = opts?.requestType ?? detectRequestType(ctx.userMessage);

  // 요청 유형에 따른 시스템 프롬프트 선택
  let systemPrompt: string;
  switch (requestType) {
    case 'translate':
      systemPrompt = buildTranslateSystemPrompt(ctx.project, opts);
      break;
    case 'question':
      systemPrompt = buildQuestionSystemPrompt(ctx.project, opts);
      break;
    default:
      systemPrompt = buildGeneralSystemPrompt(ctx.project, opts);
  }

  // 컨텍스트 조립
  const blockContext = buildBlockContextText(ctx.contextBlocks);
  const translationRules = formatTranslationRules(ctx.translationRules);
  const glossaryInjected = formatGlossaryInjected(ctx.glossaryInjected);
  const projectContext = formatProjectContext(ctx.projectContext);
  const sourceDoc = formatDocument('원문', ctx.sourceDocument);
  const targetDoc = formatDocument('번역문', ctx.targetDocument);

  const systemContext = [
    translationRules,
    glossaryInjected,
    projectContext,
    sourceDoc,
    targetDoc,
    formatAttachments(ctx.attachments),
    blockContext,
  ]
    .filter(Boolean)
    .join('\n\n');

  const history = mapRecentMessagesToHistory(ctx.recentMessages);

  // 프롬프트 템플릿 구성
  // Google Gemini 등 일부 모델은 System Message가 맨 앞에 하나만 있어야 하거나, 
  // System Message가 아예 지원되지 않는 경우(Human으로 변환 등)가 있을 수 있음.
  // LangChain은 이를 어느 정도 추상화하지만, 안전을 위해 System Message를 하나로 합치는 것이 좋음.
  const fullSystemPrompt = systemContext 
    ? `${systemPrompt}\n\n[Context]\n${systemContext}`
    : systemPrompt;

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '{fullSystemPrompt}'],
    new MessagesPlaceholder('history'),
    ['human', '{input}'],
  ]);

  return await prompt.formatMessages({
    fullSystemPrompt,
    history,
    input: ctx.userMessage,
  });
}

// ============================================
// 번역 전용 프롬프트 빌더 (간결한 응답)
// ============================================

export async function buildTranslateOnlyMessages(
  sourceText: string,
  opts?: {
    targetLanguage?: string;
    translationRules?: string;
    projectContext?: string;
    translatorPersona?: string;
  },
): Promise<BaseMessage[]> {
  const tgtLang = opts?.targetLanguage ?? 'Target';
  const persona = opts?.translatorPersona?.trim()
    ? opts.translatorPersona
    : '당신은 경험많은 전문 번역가입니다.';

  const systemPrompt = [
    persona,
    `다음 원문을 ${tgtLang}로 자연스럽게 번역하세요.`,
    '',
    '중요: 번역문만 출력하세요.',
    '- 설명, 인사, 부연 없이 오직 번역 결과만 응답합니다.',
    '- 고유명사, 태그, 변수는 그대로 유지합니다.',
    opts?.translationRules ? `\n[번역 규칙]\n${opts.translationRules}` : '',
    opts?.projectContext ? `\n[Project Context]\n${opts.projectContext}` : '',
  ].filter(Boolean).join('\n');

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '{systemPrompt}'],
    ['human', '{input}'],
  ]);

  return await prompt.formatMessages({
    systemPrompt,
    input: sourceText,
  });
}
