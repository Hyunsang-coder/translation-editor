import type { ITEProject } from '@/types';
import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import i18n from '@/i18n/config';
import {
  translateInChunks,
  type TranslationProgressCallback,
  type ChunkedTranslationResult,
} from './chunking';
import {
  tipTapJsonToMarkdownForTranslation,
  markdownToTipTapJsonForTranslation,
  estimateMarkdownTokens,
  detectMarkdownTruncation,
  extractTranslationMarkdown,
  isValidTipTapDocJson,
  type TipTapDocJson,
} from '@/utils/markdownConverter';
import {
  extractImages,
  restoreImages,
  estimateTokenSavings,
} from '@/utils/imagePlaceholder';

// TipTapDocJson 타입을 re-export
export type { TipTapDocJson };

// ============================================================
// 타임아웃/재시도 에러 판단
// ============================================================

/**
 * 타임아웃 에러인지 판단
 */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('timedout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted')
  );
}

/**
 * 재시도 가능한 번역 에러인지 판단
 */
export function isRetryableTranslationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();

  return (
    msg.includes('파싱') ||
    msg.includes('비어') ||
    msg.includes('truncat') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('translationpreviewerror') ||
    msg.includes('unclosed') ||
    msg.includes('incomplete') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up')
  );
}

/**
 * 에러 메시지를 사용자 친화적으로 변환
 */
export function formatTranslationError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (isTimeoutError(error)) {
    return '번역 요청 시간이 초과되었습니다. 문서가 복잡하거나 길 경우 자동으로 분할 번역됩니다. 다시 시도해주세요.';
  }

  const msg = error.message;

  if (msg.includes('파싱') || msg.includes('JSON')) {
    return '번역 결과를 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.';
  }

  if (msg.includes('비어') || msg.includes('empty')) {
    return '번역 응답이 비어 있습니다. 다시 시도해주세요.';
  }

  if (msg.includes('truncat') || msg.includes('잘렸') || msg.includes('Unclosed')) {
    return '번역 응답이 잘렸습니다. 문서를 분할하여 다시 시도합니다.';
  }

  return msg;
}

/**
 * Source 전체를 TipTap JSON 형태로 번역합니다.
 *
 * Markdown 파이프라인:
 * 1. TipTap JSON → Markdown 변환
 * 2. Markdown으로 LLM 호출 (토큰 효율적)
 * 3. Markdown 응답 → TipTap JSON 변환
 *
 * - 번역(Translate) 모드는 채팅 히스토리를 컨텍스트에 포함하지 않습니다.
 */
export async function translateSourceDocToTargetDocJson(params: {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  translationRules?: string | undefined;
  projectContext?: string | undefined;
  translatorPersona?: string | undefined;
  /** 용어집 (source = target 형식) */
  glossary?: string | undefined;
  /** 취소 신호 */
  abortSignal?: AbortSignal | undefined;
}): Promise<{ doc: TipTapDocJson; raw: string }> {
  const cfg = getAiConfig({ useFor: 'translation' });

  // mock provider는 더 이상 지원하지 않음
  if (cfg.provider === 'mock') {
    throw new Error('Mock provider는 더 이상 지원되지 않습니다. API 키를 설정해주세요.');
  }

  // API 키 검증 (provider별 분기)
  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error(i18n.t('errors.anthropicApiKeyMissing'));
    }
  } else {
    if (!cfg.openaiApiKey) {
      throw new Error(i18n.t('errors.openaiApiKeyMissing'));
    }
  }

  // ============================================================
  // TipTap JSON → Markdown 변환 + 이미지 플레이스홀더 적용
  // ============================================================
  const rawSourceMarkdown = tipTapJsonToMarkdownForTranslation(params.sourceDocJson);

  // 이미지 URL(특히 Base64)을 플레이스홀더로 대체하여 토큰 절약
  const { sanitized: sourceMarkdown, imageMap } = extractImages(rawSourceMarkdown);

  // 이미지 토큰 절약량 로깅 (디버그용)
  if (imageMap.size > 0) {
    const savedTokens = estimateTokenSavings(imageMap);
    console.log(`[Translation] Image placeholder: ${imageMap.size} images, ~${savedTokens.toLocaleString()} tokens saved`);
  }

  const srcLang = 'Source';
  const tgtLang = params.project.metadata.targetLanguage ?? 'Target';

  const persona = params.translatorPersona?.trim()
    ? params.translatorPersona
    : '당신은 경험많은 전문 번역가입니다.';

  const systemLines: string[] = [
    persona,
    `아래에 제공되는 Markdown 문서의 텍스트를 ${srcLang}에서 ${tgtLang}로 자연스럽게 번역하세요.`,
    '',
    '=== 중요: 출력 형식 ===',
    '반드시 아래 형태로만 출력하세요:',
    '',
    '---TRANSLATION_START---',
    '[번역된 Markdown]',
    '---TRANSLATION_END---',
    '',
    '절대 금지 사항:',
    '- "번역 결과입니다", "다음과 같이 번역했습니다" 등의 설명문 금지',
    '- 인사말, 부연 설명 금지',
    '- 구분자 외부에 텍스트 금지',
    '- 오직 구분자 내부에 번역된 Markdown만 출력',
    '',
    '=== 번역 규칙 ===',
    '- 문서 구조/서식(heading, list, bold, italic, link, table 등)은 그대로 유지하고, 텍스트 내용만 번역하세요.',
    '- HTML 테이블(<table>...</table>)이 있으면 테이블 구조와 속성은 그대로 유지하고, 셀 안의 텍스트만 번역하세요.',
    '- 링크 URL(href), 숫자, 코드/태그/변수(예: {var}, <tag>, %s)는 그대로 유지하세요.',
    '- 불확실하면 임의로 꾸미지 말고 원문 표현을 최대한 보존하세요.',
    '',
  ];

  const rules = params.translationRules?.trim();
  if (rules) {
    systemLines.push('[번역 규칙]', rules, '');
  }

  const projectContext = params.projectContext?.trim();
  if (projectContext) {
    systemLines.push('[Project Context]', projectContext, '');
  }

  const glossary = params.glossary?.trim();
  if (glossary) {
    systemLines.push('[용어집]', '아래 용어집의 번역을 준수하세요:', glossary, '');
  }

  const systemPrompt = systemLines.join('\n').trim();

  // ============================================================
  // 동적 max_tokens 계산 (Markdown 기준, JSON 오버헤드 없음)
  // ============================================================
  const estimatedInputTokens = estimateMarkdownTokens(sourceMarkdown);
  const systemPromptTokens = estimateMarkdownTokens(systemPrompt);
  const totalInputTokens = estimatedInputTokens + systemPromptTokens;

  // 컨텍스트 윈도우: OpenAI 400k, Anthropic 200k
  const MAX_CONTEXT = cfg.provider === 'anthropic' ? 200_000 : 400_000;
  const SAFETY_MARGIN = 0.9;
  const availableOutputTokens = Math.floor((MAX_CONTEXT * SAFETY_MARGIN) - totalInputTokens);

  // 최소 출력 토큰 보장 (입력보다 약간 많게 - 번역 시 텍스트가 늘어날 수 있음)
  const minOutputTokens = Math.max(estimatedInputTokens * 1.5, 8192);
  // 최대 출력 토큰: Provider/모델별 제한 고려
  // - Claude 계열: 64000 (Haiku 4.5 기준)
  // - GPT-5 시리즈: 65536
  // - GPT-4o 등 이전 모델: 16384
  const maxAllowedTokens = cfg.provider === 'anthropic'
    ? 64000
    : (cfg.model?.startsWith('gpt-5') ? 65536 : 16384);
  const calculatedMaxTokens = Math.max(minOutputTokens, Math.min(availableOutputTokens, maxAllowedTokens));

  // 입력이 너무 큰 경우 사전 에러
  if (availableOutputTokens < minOutputTokens) {
    throw new Error(
      `문서가 너무 큽니다. 예상 입력: ${totalInputTokens.toLocaleString()} 토큰, ` +
      `최대 허용: ${Math.floor(MAX_CONTEXT * 0.6).toLocaleString()} 토큰. ` +
      `문서를 분할하여 번역해주세요.`
    );
  }

  // createChatModel()을 사용하여 provider별 모델 생성
  const model = createChatModel(undefined, {
    useFor: 'translation',
    maxTokens: calculatedMaxTokens,
  });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        '아래 Markdown 문서를 번역하여, 구분자 내에 번역된 Markdown만 반환하세요.',
        '',
        '---INPUT_DOCUMENT_START---',
        sourceMarkdown,
        '---INPUT_DOCUMENT_END---',
        '',
        '(DO NOT TRANSLATE THIS INSTRUCTION) Output ONLY the translated Markdown between ---TRANSLATION_START--- and ---TRANSLATION_END--- markers.',
      ].join('\n'),
    },
  ];

  // 취소 확인
  if (params.abortSignal?.aborted) {
    throw new Error('번역이 취소되었습니다.');
  }

  // 번역 실행
  const invokeOptions = params.abortSignal ? { signal: params.abortSignal } : {};
  const res = await model.invoke(messages, invokeOptions);

  // finish_reason 확인 (응답 잘림 감지)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finishReason = (res as any)?.response_metadata?.finish_reason;
  if (finishReason === 'length') {
    throw new Error(
      `응답이 토큰 제한으로 잘렸습니다 (finish_reason: length). ` +
      `문서를 분할하여 번역하거나 다시 시도해주세요.`
    );
  }

  // 응답 텍스트 추출
  const rawContent = res.content;
  const raw = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map(c => typeof c === 'string' ? c : (c as { text?: string }).text || '').join('')
      : String(rawContent);

  // 응답이 비어있는 경우
  if (!raw || raw.trim().length === 0) {
    throw new Error('번역 응답이 비어 있습니다. 모델이 응답을 생성하지 못했습니다.');
  }

  // ============================================================
  // Markdown 응답 추출 및 검증
  // ============================================================
  const translatedMarkdownRaw = extractTranslationMarkdown(raw);

  // Markdown truncation 감지
  const truncation = detectMarkdownTruncation(translatedMarkdownRaw);
  if (truncation.isTruncated) {
    throw new Error(
      `${i18n.t('errors.translationPreviewError')}\n` +
      `응답이 잘렸습니다: ${truncation.reason}\n` +
      `다시 시도해주세요.`
    );
  }

  // ============================================================
  // 이미지 플레이스홀더 복원 + Markdown → TipTap JSON 변환
  // ============================================================
  const translatedMarkdown = imageMap.size > 0
    ? restoreImages(translatedMarkdownRaw, imageMap)
    : translatedMarkdownRaw;

  const translatedDoc = markdownToTipTapJsonForTranslation(translatedMarkdown);

  if (!isValidTipTapDocJson(translatedDoc)) {
    throw new Error('번역 결과가 TipTap doc JSON 형식이 아닙니다.');
  }

  return { doc: translatedDoc, raw };
}

// ============================================================
// 진행률 콜백 타입 export
// ============================================================

export type { TranslationProgressCallback, ChunkedTranslationResult };

// ============================================================
// 스트리밍 번역 (실시간 타이핑 효과)
// ============================================================

import type { ReviewIssue } from '@/stores/reviewStore';

/**
 * 스트리밍 번역 파라미터
 */
export interface StreamingTranslationParams {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  translationRules?: string;
  projectContext?: string;
  translatorPersona?: string;
  /** 용어집 (source = target 형식) */
  glossary?: string;
  /** 검수 이슈 (재번역 시 컨텍스트로 전달) */
  reviewIssues?: ReviewIssue[];
  /** 실시간 텍스트 콜백 (누적된 전체 텍스트) */
  onToken?: (accumulatedText: string) => void;
  /** 취소 신호 */
  abortSignal?: AbortSignal;
}

/**
 * 스트리밍 방식으로 번역을 수행합니다.
 *
 * - 실시간으로 번역 텍스트가 타이핑되는 효과
 * - 완료 후 TipTap JSON으로 변환
 * - onToken 콜백으로 누적된 텍스트 전달
 */
export async function translateWithStreaming(
  params: StreamingTranslationParams
): Promise<{ doc: TipTapDocJson; raw: string }> {
  const cfg = getAiConfig({ useFor: 'translation' });

  if (cfg.provider === 'mock') {
    throw new Error('Mock provider는 더 이상 지원되지 않습니다. API 키를 설정해주세요.');
  }

  // API 키 검증 (provider별 분기)
  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) {
      throw new Error(i18n.t('errors.anthropicApiKeyMissing'));
    }
  } else {
    if (!cfg.openaiApiKey) {
      throw new Error(i18n.t('errors.openaiApiKeyMissing'));
    }
  }

  // TipTap JSON → Markdown 변환 + 이미지 플레이스홀더 적용
  const rawSourceMarkdown = tipTapJsonToMarkdownForTranslation(params.sourceDocJson);
  const { sanitized: sourceMarkdown, imageMap } = extractImages(rawSourceMarkdown);

  // 이미지 토큰 절약량 로깅 (디버그용)
  if (imageMap.size > 0) {
    const savedTokens = estimateTokenSavings(imageMap);
    console.log(`[Streaming Translation] Image placeholder: ${imageMap.size} images, ~${savedTokens.toLocaleString()} tokens saved`);
  }

  const srcLang = 'Source';
  const tgtLang = params.project.metadata.targetLanguage ?? 'Target';

  const persona = params.translatorPersona?.trim()
    ? params.translatorPersona
    : '당신은 경험많은 전문 번역가입니다.';

  const systemLines: string[] = [
    persona,
    `아래에 제공되는 Markdown 문서의 텍스트를 ${srcLang}에서 ${tgtLang}로 자연스럽게 번역하세요.`,
    '',
    '=== 중요: 출력 형식 ===',
    '반드시 아래 형태로만 출력하세요:',
    '',
    '---TRANSLATION_START---',
    '[번역된 Markdown]',
    '---TRANSLATION_END---',
    '',
    '절대 금지 사항:',
    '- "번역 결과입니다", "다음과 같이 번역했습니다" 등의 설명문 금지',
    '- 인사말, 부연 설명 금지',
    '- 구분자 외부에 텍스트 금지',
    '- 오직 구분자 내부에 번역된 Markdown만 출력',
    '',
    '=== 번역 규칙 ===',
    '- 문서 구조/서식(heading, list, bold, italic, link, table 등)은 그대로 유지하고, 텍스트 내용만 번역하세요.',
    '- HTML 테이블(<table>...</table>)이 있으면 테이블 구조와 속성은 그대로 유지하고, 셀 안의 텍스트만 번역하세요.',
    '- 링크 URL(href), 숫자, 코드/태그/변수(예: {var}, <tag>, %s)는 그대로 유지하세요.',
    '- 불확실하면 임의로 꾸미지 말고 원문 표현을 최대한 보존하세요.',
    '',
  ];

  const rules = params.translationRules?.trim();
  if (rules) {
    systemLines.push('[번역 규칙]', rules, '');
  }

  const projectContext = params.projectContext?.trim();
  if (projectContext) {
    systemLines.push('[Project Context]', projectContext, '');
  }

  const glossary = params.glossary?.trim();
  if (glossary) {
    systemLines.push('[용어집]', '아래 용어집의 번역을 준수하세요:', glossary, '');
  }

  // 검수 이슈가 있으면 재번역 컨텍스트로 추가
  if (params.reviewIssues && params.reviewIssues.length > 0) {
    const typeLabels: Record<string, string> = {
      omission: '누락',
      addition: '추가',
      nuance_shift: '뉘앙스 변형',
      terminology: '용어 불일치',
      mistranslation: '오역',
    };
    const issuesContext = params.reviewIssues.map((issue, idx) => {
      return [
        `${idx + 1}. [${typeLabels[issue.type] || issue.type}] "${issue.sourceExcerpt || ''}" → "${issue.targetExcerpt || '(누락)'}"`,
        `   문제: ${issue.description || ''}`,
        issue.suggestedFix ? `   수정 제안: ${issue.suggestedFix}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    systemLines.push(
      '[검수 이슈 - 반드시 수정 필요!]',
      '아래 검수에서 발견된 이슈들을 해결하는 방향으로 번역하세요:',
      issuesContext,
      ''
    );
  }

  const systemPrompt = systemLines.join('\n').trim();

  // 동적 max_tokens 계산
  const estimatedInputTokens = estimateMarkdownTokens(sourceMarkdown);
  const systemPromptTokens = estimateMarkdownTokens(systemPrompt);
  const totalInputTokens = estimatedInputTokens + systemPromptTokens;

  // 컨텍스트 윈도우: OpenAI 400k, Anthropic 200k
  const MAX_CONTEXT = cfg.provider === 'anthropic' ? 200_000 : 400_000;
  const SAFETY_MARGIN = 0.9;
  const availableOutputTokens = Math.floor((MAX_CONTEXT * SAFETY_MARGIN) - totalInputTokens);

  const minOutputTokens = Math.max(estimatedInputTokens * 1.5, 8192);
  // 최대 출력 토큰: Provider/모델별 제한 고려
  // - Claude 계열: 64000 (Haiku 4.5 기준)
  // - GPT-5 시리즈: 65536
  // - GPT-4o 등 이전 모델: 16384
  const maxAllowedTokens = cfg.provider === 'anthropic'
    ? 64000
    : (cfg.model?.startsWith('gpt-5') ? 65536 : 16384);
  const calculatedMaxTokens = Math.max(minOutputTokens, Math.min(availableOutputTokens, maxAllowedTokens));

  if (availableOutputTokens < minOutputTokens) {
    throw new Error(
      `문서가 너무 큽니다. 예상 입력: ${totalInputTokens.toLocaleString()} 토큰, ` +
      `최대 허용: ${Math.floor(MAX_CONTEXT * 0.6).toLocaleString()} 토큰. ` +
      `문서를 분할하여 번역해주세요.`
    );
  }

  // createChatModel()을 사용하여 provider별 모델 생성
  const model = createChatModel(undefined, {
    useFor: 'translation',
    maxTokens: calculatedMaxTokens,
  });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        '아래 Markdown 문서를 번역하여, 구분자 내에 번역된 Markdown만 반환하세요.',
        '',
        '---INPUT_DOCUMENT_START---',
        sourceMarkdown,
        '---INPUT_DOCUMENT_END---',
        '',
        '(DO NOT TRANSLATE THIS INSTRUCTION) Output ONLY the translated Markdown between ---TRANSLATION_START--- and ---TRANSLATION_END--- markers.',
      ].join('\n'),
    },
  ];

  // 취소 확인
  if (params.abortSignal?.aborted) {
    throw new Error('번역이 취소되었습니다.');
  }

  // 스트리밍 실행
  let accumulated = '';
  const streamOptions = params.abortSignal ? { signal: params.abortSignal } : {};
  const stream = await model.stream(messages, streamOptions);

  for await (const chunk of stream) {
    // 취소 확인
    if (params.abortSignal?.aborted) {
      throw new Error('번역이 취소되었습니다.');
    }

    // chunk.content에서 텍스트 추출
    const delta = typeof chunk.content === 'string'
      ? chunk.content
      : Array.isArray(chunk.content)
        ? chunk.content.map(c => typeof c === 'string' ? c : (c as { text?: string }).text || '').join('')
        : '';

    if (delta) {
      accumulated += delta;
      // 마커 이후 텍스트만 콜백에 전달 (지침 반복 필터링)
      const startMarker = '---TRANSLATION_START---';
      const endMarker = '---TRANSLATION_END---';
      const startIdx = accumulated.indexOf(startMarker);
      if (startIdx !== -1) {
        let filtered = accumulated.slice(startIdx + startMarker.length);
        const endIdx = filtered.indexOf(endMarker);
        if (endIdx !== -1) {
          filtered = filtered.slice(0, endIdx);
        }
        params.onToken?.(filtered.trim());
      }
      // 마커가 아직 없으면 콜백 호출 안함 (로딩 상태 유지)
    }
  }

  // 응답이 비어있는 경우
  if (!accumulated || accumulated.trim().length === 0) {
    throw new Error('번역 응답이 비어 있습니다. 모델이 응답을 생성하지 못했습니다.');
  }

  // Markdown 응답 추출 및 검증
  const translatedMarkdownRaw = extractTranslationMarkdown(accumulated);

  const truncation = detectMarkdownTruncation(translatedMarkdownRaw);
  if (truncation.isTruncated) {
    throw new Error(
      `${i18n.t('errors.translationPreviewError')}\n` +
      `응답이 잘렸습니다: ${truncation.reason}\n` +
      `다시 시도해주세요.`
    );
  }

  // 이미지 플레이스홀더 복원 + Markdown → TipTap JSON 변환
  const translatedMarkdown = imageMap.size > 0
    ? restoreImages(translatedMarkdownRaw, imageMap)
    : translatedMarkdownRaw;

  const translatedDoc = markdownToTipTapJsonForTranslation(translatedMarkdown);

  if (!isValidTipTapDocJson(translatedDoc)) {
    throw new Error('번역 결과가 TipTap doc JSON 형식이 아닙니다.');
  }

  return { doc: translatedDoc, raw: accumulated };
}

// ============================================================
// 청크 분할 번역 (대용량 문서 지원)
// ============================================================

/**
 * 청크 분할 번역 파라미터
 */
export interface ChunkedTranslationParams {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  translationRules?: string;
  projectContext?: string;
  translatorPersona?: string;
  /** 용어집 (source = target 형식) */
  glossary?: string;
  /** 진행률 콜백 */
  onProgress?: TranslationProgressCallback;
  /** 취소 신호 */
  abortSignal?: AbortSignal;
}

/**
 * 청크 분할 번역 결과 (호환성)
 */
export interface TranslationResult {
  doc: TipTapDocJson;
  raw: string;
  /** 청킹 사용 여부 */
  wasChunked?: boolean;
  /** 총 청크 수 */
  totalChunks?: number;
  /** 성공한 청크 수 */
  successfulChunks?: number;
}

/**
 * 대용량 문서를 위한 청크 분할 번역
 *
 * - 8K 토큰 미만: 단일 호출 (기존 방식)
 * - 8K 토큰 이상: 청크 분할 후 순차 번역
 * - 진행률 콜백 지원
 * - 부분 실패 시 원본 노드로 폴백
 *
 * @param params - 번역 파라미터
 * @returns 번역 결과 (doc, raw, 메타 정보)
 */
export async function translateSourceDocWithChunking(
  params: ChunkedTranslationParams
): Promise<TranslationResult> {
  const {
    project,
    sourceDocJson,
    translationRules,
    projectContext,
    translatorPersona,
    glossary,
    onProgress,
    abortSignal,
  } = params;

  // 청크 분할 번역 실행
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await translateInChunks({
    project,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceDocJson: sourceDocJson as any,
    translationRules,
    projectContext,
    translatorPersona,
    glossary,
    onProgress,
    abortSignal,
    translateSingleChunk: async (chunkParams) => {
      // 기존 단일 번역 함수 호출 (abortSignal 전달)
      const translated = await translateSourceDocToTargetDocJson({
        project: chunkParams.project,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sourceDocJson: chunkParams.sourceDocJson as any,
        translationRules: chunkParams.translationRules,
        projectContext: chunkParams.projectContext,
        translatorPersona: chunkParams.translatorPersona,
        glossary: chunkParams.glossary,
        abortSignal,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return translated as any;
    },
  });

  // 결과 처리
  if (!result.success) {
    throw new Error(result.error || '번역에 실패했습니다.');
  }

  if (!result.doc) {
    throw new Error('번역 결과가 없습니다.');
  }

  return {
    doc: result.doc as TipTapDocJson,
    raw: result.raw || JSON.stringify(result.doc),
    wasChunked: result.wasChunked,
    totalChunks: result.totalChunks,
    successfulChunks: result.successfulChunks,
  };
}

