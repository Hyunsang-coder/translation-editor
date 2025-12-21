import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { ChatMessage, EditorBlock, ITEProject } from '@/types';
import { stripHtml } from '@/utils/hash';

export interface PromptContext {
  project: ITEProject | null;
  contextBlocks: EditorBlock[];
  recentMessages: ChatMessage[];
  userMessage: string;
  /**
   * 참조문서/용어집/메모 등 추가 컨텍스트(사용자 입력)
   */
  referenceNotes?: string;
  /**
   * 로컬 글로서리 검색 결과(자동 주입)
   * - TRD 5.2: 비벡터, on-demand 모델 호출 시에만 payload에 포함
   */
  glossaryInjected?: string;
  /**
   * 컨텍스트 블록 매핑 실패 시 주입할 원문 전체(plain) fallback
   */
  fallbackSourceText?: string;
  /**
   * Active Memory(용어/톤 규칙 요약)
   */
  activeMemory?: string;
  /**
   * 전체 원문/번역 문서 (사용자 선택 시 주입)
   */
  sourceDocument?: string;
  targetDocument?: string;
}

export interface PromptOptions {
  /**
   * 사용자 편집 가능한 시스템 프롬프트 오버레이
   * - TRD 3.2: Project meta + 사용자 지침을 함께 반영
   */
  systemPromptOverlay?: string;
}

function buildSystemPolicyPrompt(): string {
  return [
    '너는 번역가를 돕는 AI 어시스턴트다.',
    '',
    '규칙:',
    '- 사용자는 한국어로 응답을 선호한다. 가능하면 한국어로 답한다.',
    '- 사용자가 요청하기 전에는 과도한 제안/개입을 하지 않는다(On-Demand AI).',
    '- 불확실한 내용은 추측하지 말고 확인 질문을 먼저 한다.',
    '- 컨텍스트로 제공된 블록 내용(원문/번역)을 우선으로 참고한다.',
  ].join('\n');
}

function buildSystemMetaPrompt(project: ITEProject | null, opts?: PromptOptions): string {
  const domain = project?.metadata.domain ?? 'general';
  const src = project?.metadata.sourceLanguage ?? 'Source';
  const tgt = project?.metadata.targetLanguage ?? 'Target';
  const overlay = opts?.systemPromptOverlay?.trim();

  return [
    `프로젝트 도메인: ${domain}`,
    `언어: ${src} → ${tgt}`,
    overlay ? `- 추가 지침: ${overlay}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatReferenceNotes(notes?: string): string {
  const trimmed = notes?.trim();
  if (!trimmed) return '';
  return ['참조 메모/용어집:', trimmed].join('\n');
}

function formatGlossaryInjected(glossary?: string): string {
  const trimmed = glossary?.trim();
  if (!trimmed) return '';
  return ['주입된 로컬 글로서리(자동):', trimmed].join('\n');
}

function formatActiveMemory(memory?: string): string {
  const trimmed = memory?.trim();
  if (!trimmed) return '';
  const maxLen = 1200;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}\n...` : trimmed;
  return ['Active Memory(용어/톤 규칙):', sliced].join('\n');
}

function formatFallbackSource(text?: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  const maxLen = 2000; // 과도한 컨텍스트 방지
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}\n...` : trimmed;
  return ['원문 참조(fallback):', sliced].join('\n');
}

function formatFullDocument(label: string, text?: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  const maxLen = 4000;
  const sliced = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}\n...` : trimmed;
  return [`${label} 문서:`, sliced].join('\n');
}

export function buildSystemPrompt(project: ITEProject | null, opts?: PromptOptions): string {
  const domain = project?.metadata.domain ?? 'general';
  const src = project?.metadata.sourceLanguage ?? 'Source';
  const tgt = project?.metadata.targetLanguage ?? 'Target';

  const overlay = opts?.systemPromptOverlay?.trim();

  return [
    '너는 번역가를 돕는 AI 어시스턴트다.',
    `프로젝트 도메인: ${domain}`,
    `언어: ${src} → ${tgt}`,
    '',
    '규칙:',
    '- 사용자는 한국어로 응답을 선호한다. 가능하면 한국어로 답한다.',
    '- 사용자가 요청하기 전에는 과도한 제안/개입을 하지 않는다(On-Demand AI).',
    '- 불확실한 내용은 추측하지 말고 확인 질문을 먼저 한다.',
    '- 컨텍스트로 제공된 블록 내용(원문/번역)을 우선으로 참고한다.',
    overlay ? `- 추가 지침: ${overlay}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildBlockContextText(blocks: EditorBlock[]): string {
  if (blocks.length === 0) return '';

  const lines: string[] = [];
  lines.push('현재 컨텍스트 블록:');
  for (const b of blocks) {
    const plain = stripHtml(b.content);
    lines.push(`- [${b.type}] ${b.id}: ${plain}`);
  }
  return lines.join('\n');
}

function mapRecentMessagesToHistory(recentMessages: ChatMessage[]): BaseMessage[] {
  const history: BaseMessage[] = [];
  for (const m of recentMessages) {
    if (m.role === 'user') history.push(new HumanMessage(m.content));
    if (m.role === 'assistant') history.push(new AIMessage(m.content));
    // system 메시지는 모델에 별도로 이미 주입했으므로 생략
  }
  return history;
}

export async function buildLangChainMessages(
  ctx: PromptContext,
  opts?: PromptOptions,
): Promise<BaseMessage[]> {
  const systemPolicy = buildSystemPolicyPrompt();
  const systemMeta = buildSystemMetaPrompt(ctx.project, opts);
  const blockContext = buildBlockContextText(ctx.contextBlocks);
  const refNotes = formatReferenceNotes(ctx.referenceNotes);
  const glossaryInjected = formatGlossaryInjected(ctx.glossaryInjected);
  const activeMemory = formatActiveMemory(ctx.activeMemory);
  const sourceFallback = formatFallbackSource(ctx.fallbackSourceText);
  const fullSource = formatFullDocument('원문', ctx.sourceDocument);
  const fullTarget = formatFullDocument('번역문', ctx.targetDocument);

  const systemContext = [
    blockContext,
    glossaryInjected,
    refNotes,
    activeMemory,
    fullSource,
    fullTarget,
    ctx.contextBlocks.length === 0 ? sourceFallback : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const history = mapRecentMessagesToHistory(ctx.recentMessages);

  // 컨텍스트가 비어있으면 빈 system 메시지를 보내지 않도록 템플릿을 분기
  const prompt = systemContext
    ? ChatPromptTemplate.fromMessages([
        ['system', '{systemPolicy}'],
        ['system', '{systemMeta}'],
        ['system', '{systemContext}'],
        new MessagesPlaceholder('history'),
        ['human', '{input}'],
      ])
    : ChatPromptTemplate.fromMessages([
        ['system', '{systemPolicy}'],
        ['system', '{systemMeta}'],
        new MessagesPlaceholder('history'),
        ['human', '{input}'],
      ]);

  return await prompt.formatMessages({
    systemPolicy,
    systemMeta,
    ...(systemContext ? { systemContext } : {}),
    history,
    input: ctx.userMessage,
  });
}


