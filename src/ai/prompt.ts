import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { stripHtml } from '@/utils/hash';

// ============================================
// 요청 유형 정의
// ============================================

export type RequestType = 'translate' | 'question' | 'general';

/**
 * 사용자 메시지에서 요청 유형을 감지
 * - 번역 요청: "번역", "translate", "~로 옮겨", "~로 바꿔" 등
 * - 질문 요청: "?", "무엇", "왜", "어떻게", "뭐야", "알려줘" 등
 */
export function detectRequestType(message: string): RequestType {
  const lowerMessage = message.toLowerCase();
  
  // 번역 관련 키워드
  const translateKeywords = [
    '번역', 'translate', '옮겨', '바꿔줘', '변환', '한국어로', '영어로', 
    '일본어로', '중국어로', '자연스럽게', '다듬어', '수정해', '고쳐'
  ];
  
  // 질문 관련 키워드
  const questionKeywords = [
    '?', '무엇', '뭐', '왜', '어떻게', '어디', '언제', '누가',
    '알려', '설명', '의미', '뜻이', '차이', '맞아', '틀려'
  ];
  
  for (const keyword of translateKeywords) {
    if (lowerMessage.includes(keyword)) {
      return 'translate';
    }
  }
  
  for (const keyword of questionKeywords) {
    if (lowerMessage.includes(keyword)) {
      return 'question';
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
  /** Active Memory (용어/톤 규칙 요약) */
  activeMemory?: string;
  /** 원문 문서 */
  sourceDocument?: string;
  /** 번역문 문서 */
  targetDocument?: string;
}

export interface PromptOptions {
  /** 사용자 편집 가능한 시스템 프롬프트 오버레이 */
  systemPromptOverlay?: string;
  /** 요청 유형 (자동 감지 또는 명시적 지정) */
  requestType?: RequestType;
}

// ============================================
// 시스템 프롬프트 빌더
// ============================================

function buildBaseSystemPrompt(project: ITEProject | null): string {
  const domain = project?.metadata.domain ?? 'general';
  const src = project?.metadata.sourceLanguage ?? 'Source';
  const tgt = project?.metadata.targetLanguage ?? 'Target';

  return [
    '당신은 전문 번역가를 돕는 AI 어시스턴트입니다.',
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

function buildTranslateSystemPrompt(project: ITEProject | null): string {
  const base = buildBaseSystemPrompt(project);
  
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

function buildQuestionSystemPrompt(project: ITEProject | null): string {
  const base = buildBaseSystemPrompt(project);
  
  return [
    base,
    '',
    '=== 질문 응답 모드 ===',
    '- 질문에 간결하게 답변합니다.',
    '- 필요한 경우에만 예시를 들어 설명합니다.',
    '',
    '허용 범위(검수/리뷰/검증):',
    '- 원문↔번역문 비교로 누락/오역/과잉 번역을 지적합니다.',
    '- 용어/표기/톤/문체 일관성 위반을 찾아 설명합니다.',
    '- “어떻게 고치면 좋은지” 방향/원칙을 제안할 수 있습니다.',
    '',
    '금지 범위(번역 생성):',
    '- 번역문/리라이트/전체 번역 결과를 채팅에서 그대로 생성해 출력하지 않습니다.',
    '- 사용자가 번역/리라이트/전체 번역을 요청하면:',
    '  - (필요 시) 확인 질문을 0~1개만 합니다. (예: 톤/금지어/용어 규칙)',
    '  - 그 외에는 "Translate(Preview) 버튼을 누르세요"라고만 안내합니다.',
    '',
    '출력 포맷:',
    '- 간결하게 작성하고, 필요 시 불릿/리스트/강조(볼드/이탤릭)를 사용할 수 있습니다.',
  ].join('\n');
}

function buildGeneralSystemPrompt(project: ITEProject | null, opts?: PromptOptions): string {
  const base = buildBaseSystemPrompt(project);
  const overlay = opts?.systemPromptOverlay?.trim();
  
  return [
    base,
    overlay ? `\n추가 지침: ${overlay}` : '',
  ].filter(Boolean).join('\n');
}

// ============================================
// 컨텍스트 포매터
// ============================================

function formatTranslationRules(rules?: string): string {
  const trimmed = rules?.trim();
  if (!trimmed) return '';
  return ['[번역 규칙]', trimmed].join('\n');
}

function formatActiveMemory(memory?: string): string {
  const trimmed = memory?.trim();
  if (!trimmed) return '';
  const maxLen = 1200;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  return ['[Active Memory - 용어/톤 규칙]', sliced].join('\n');
}

function formatDocument(label: string, text?: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  const maxLen = 4000;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
  return [`[${label}]`, sliced].join('\n');
}

export function buildBlockContextText(blocks: EditorBlock[]): string {
  if (blocks.length === 0) return '';

  const lines: string[] = ['[컨텍스트 블록]'];
  for (const b of blocks) {
    const plain = stripHtml(b.content);
    lines.push(`- [${b.type}] ${plain}`);
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

function mapRecentMessagesToHistory(recentMessages: ChatMessage[]): BaseMessage[] {
  const history: BaseMessage[] = [];
  for (const m of recentMessages) {
    if (m.role === 'user') history.push(new HumanMessage(m.content));
    if (m.role === 'assistant') history.push(new AIMessage(m.content));
  }
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
      systemPrompt = buildTranslateSystemPrompt(ctx.project);
      break;
    case 'question':
      systemPrompt = buildQuestionSystemPrompt(ctx.project);
      break;
    default:
      systemPrompt = buildGeneralSystemPrompt(ctx.project, opts);
  }

  // 컨텍스트 조립
  const blockContext = buildBlockContextText(ctx.contextBlocks);
  const translationRules = formatTranslationRules(ctx.translationRules);
  const activeMemory = formatActiveMemory(ctx.activeMemory);
  const sourceDoc = formatDocument('원문', ctx.sourceDocument);
  const targetDoc = formatDocument('번역문', ctx.targetDocument);

  const systemContext = [
    translationRules,
    activeMemory,
    sourceDoc,
    targetDoc,
    blockContext,
  ]
    .filter(Boolean)
    .join('\n\n');

  const history = mapRecentMessagesToHistory(ctx.recentMessages);

  // 프롬프트 템플릿 구성
  const prompt = systemContext
    ? ChatPromptTemplate.fromMessages([
        ['system', '{systemPrompt}'],
        ['system', '{systemContext}'],
        new MessagesPlaceholder('history'),
        ['human', '{input}'],
      ])
    : ChatPromptTemplate.fromMessages([
        ['system', '{systemPrompt}'],
        new MessagesPlaceholder('history'),
        ['human', '{input}'],
      ]);

  return await prompt.formatMessages({
    systemPrompt,
    ...(systemContext ? { systemContext } : {}),
    history,
    input: ctx.userMessage,
  });
}

// ============================================
// 번역 전용 프롬프트 빌더 (간결한 응답)
// ============================================

export async function buildTranslateOnlyMessages(
  sourceText: string,
  targetLanguage: string,
  opts?: {
    translationRules?: string;
    activeMemory?: string;
  },
): Promise<BaseMessage[]> {
  const systemPrompt = [
    '당신은 전문 번역가입니다.',
    `다음 원문을 ${targetLanguage}로 번역하세요.`,
    '',
    '중요: 번역문만 출력하세요.',
    '- 설명, 인사, 부연 없이 오직 번역 결과만 응답합니다.',
    '- 고유명사, 태그, 변수는 그대로 유지합니다.',
    opts?.translationRules ? `\n[번역 규칙]\n${opts.translationRules}` : '',
    opts?.activeMemory ? `\n[참고 용어]\n${opts.activeMemory}` : '',
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
