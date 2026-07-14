import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';
import {
  ANTHROPIC_CONTEXT_WINDOW,
  CLAUDE_MAX_OUTPUT_TOKENS,
  CONTEXT_SAFETY_MARGIN,
  GPT4O_MAX_OUTPUT_TOKENS,
  GPT5_MAX_OUTPUT_TOKENS,
  OPENAI_CONTEXT_WINDOW,
} from '@/ai/constants';
import {
  detectMarkdownTruncation,
  estimateMarkdownTokens,
  fixMisalignedBoldMarks,
  isValidTipTapDocJson,
  parseTranslationResponseToTipTap,
  tipTapJsonToMarkdownForTranslation,
  type TipTapDocJson,
} from '@/utils/markdownConverter';
import { stripImages } from '@/utils/imagePlaceholder';
import i18n from '@/i18n/config';
import {
  completeWithTauriAiBackend,
  shouldRetryWithTauriAiBackend,
  streamWithTauriAiBackend,
} from '@/ai/backendCompletion';
import { isTauriRuntime } from '@/tauri/invoke';

const POLISH_START = '---POLISH_START---';
const POLISH_END = '---POLISH_END---';

function extractPolishedMarkdown(response: string): string {
  const startIdx = response.indexOf(POLISH_START);
  const endIdx = response.indexOf(POLISH_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return response.slice(startIdx + POLISH_START.length, endIdx).trim();
  }

  console.warn('[Polish] No markers found, using raw response');
  return response.trim();
}

function buildPolishSystemPrompt(params: {
  targetLanguage?: string | undefined;
  styleRules?: string | undefined;
  projectContext?: string | undefined;
  translatorPersona?: string | undefined;
  userComments?: string | undefined;
  polishMessage?: string | undefined;
}): string {
  const targetLanguage = params.targetLanguage?.trim() || 'Target';
  const rules = params.styleRules?.trim();
  const projectContext = params.projectContext?.trim();
  const persona = params.translatorPersona?.trim();
  const userComments = params.userComments?.trim();
  const polishMessage = params.polishMessage?.trim();

  return [
    `You are a native ${targetLanguage} editor.`,
    'Polish the provided translated Markdown only. Do not use or infer from the source text.',
    '',
    'Goals:',
    '- Fix awkward collocations, unnatural expressions, translationese sentence structure, and non-native flow.',
    '- Preserve meaning, terminology, numbers, names, links, variables, tags, code, tables, and Markdown structure.',
    '- Do not rewrite already natural sentences for personal style preference.',
    '- Return the complete polished Markdown, not comments or an issue list.',
    '',
    'Output exactly:',
    POLISH_START,
    '[complete polished Markdown]',
    POLISH_END,
    '',
    ...(rules ? ['Style/translation rules to respect:', rules, ''] : []),
    ...(projectContext
      ? [
          '[Project Context]',
          'Use for product/domain/tone constraints only. Do not invent or drop meaning from this context.',
          projectContext,
          '',
        ]
      : []),
    ...(persona
      ? [
          'Tone reference (stylistic guidance only; do not invent or drop meaning):',
          persona,
          '',
        ]
      : []),
    ...(userComments ? [userComments, ''] : []),
    ...(polishMessage ? ['Additional user instructions for this polishing run:', polishMessage, ''] : []),
  ].join('\n').trim();
}

function buildPolishMessages(params: {
  targetDocJson: TipTapDocJson;
  targetLanguage?: string | undefined;
  styleRules?: string | undefined;
  projectContext?: string | undefined;
  translatorPersona?: string | undefined;
  userComments?: string | undefined;
  polishMessage?: string | undefined;
}) {
  const cfg = getAiConfig({ useFor: 'translation' });

  if (cfg.provider === 'mock') {
    throw new Error('Mock provider는 더 이상 지원되지 않습니다. API 키를 설정해주세요.');
  }

  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropicApiKey) throw new Error(i18n.t('errors.anthropicApiKeyMissing'));
  } else if (!cfg.openaiApiKey) {
    throw new Error(i18n.t('errors.openaiApiKeyMissing'));
  }

  const rawTargetMarkdown = tipTapJsonToMarkdownForTranslation(params.targetDocJson);
  const { stripped: targetMarkdown, imageCount } = stripImages(rawTargetMarkdown);

  if (imageCount > 0) {
    console.warn(`[Polish] Stripped ${imageCount} images from target`);
  }

  const systemPrompt = buildPolishSystemPrompt({
    targetLanguage: params.targetLanguage,
    styleRules: params.styleRules,
    projectContext: params.projectContext,
    translatorPersona: params.translatorPersona,
    userComments: params.userComments,
    polishMessage: params.polishMessage,
  });

  const estimatedInputTokens = estimateMarkdownTokens(targetMarkdown);
  const systemPromptTokens = estimateMarkdownTokens(systemPrompt);
  const totalInputTokens = estimatedInputTokens + systemPromptTokens;
  const maxContext = cfg.provider === 'anthropic' ? ANTHROPIC_CONTEXT_WINDOW : OPENAI_CONTEXT_WINDOW;
  const availableOutputTokens = Math.floor((maxContext * CONTEXT_SAFETY_MARGIN) - totalInputTokens);
  const minOutputTokens = Math.max(Math.ceil(estimatedInputTokens * 1.25), 2048);
  const maxAllowedTokens = cfg.provider === 'anthropic'
    ? CLAUDE_MAX_OUTPUT_TOKENS
    : (cfg.model?.startsWith('gpt-5') ? GPT5_MAX_OUTPUT_TOKENS : GPT4O_MAX_OUTPUT_TOKENS);
  const calculatedMaxTokens = Math.max(minOutputTokens, Math.min(availableOutputTokens, maxAllowedTokens));

  if (availableOutputTokens < minOutputTokens) {
    throw new Error(
      `문서가 너무 큽니다. 예상 입력: ${totalInputTokens.toLocaleString()} 토큰, ` +
      `필요 출력: ${minOutputTokens.toLocaleString()} 토큰. 문서를 나누어 폴리싱해주세요.`,
    );
  }

  const maxTokens = calculatedMaxTokens;
  const model = createChatModel(undefined, {
    useFor: 'translation',
    maxTokens,
  });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        'Polish this translated Markdown and return only the complete polished Markdown inside the required markers.',
        '',
        '---TARGET_DOCUMENT_START---',
        targetMarkdown,
        '---TARGET_DOCUMENT_END---',
      ].join('\n'),
    },
  ];

  return { cfg, model, messages, maxTokens };
}

function processPolishResponse(raw: string): { doc: TipTapDocJson } {
  const polishedMarkdownRaw = extractPolishedMarkdown(raw);
  const truncation = detectMarkdownTruncation(polishedMarkdownRaw);
  if (truncation.isTruncated) {
    throw new Error(
      `${i18n.t('errors.translationPreviewError')}\n` +
      `응답이 잘렸습니다: ${truncation.reason}\n` +
      `다시 시도해주세요.`,
    );
  }

  const polishedMarkdown = fixMisalignedBoldMarks(polishedMarkdownRaw);
  const polishedDoc = parseTranslationResponseToTipTap(polishedMarkdown);
  if (!isValidTipTapDocJson(polishedDoc)) {
    throw new Error('폴리싱 결과가 TipTap doc JSON 형식이 아닙니다.');
  }
  return { doc: polishedDoc };
}

export interface PolishTargetDocumentParams {
  targetDocJson: TipTapDocJson;
  targetLanguage?: string | undefined;
  styleRules?: string | undefined;
  /** 프로젝트 컨텍스트(제품/도메인/톤 제약). 의미 추론용으로 쓰지 않음. */
  projectContext?: string | undefined;
  /** 톤 참고용 페르소나. 스타일 가이드로만 사용. */
  translatorPersona?: string | undefined;
  /** 폴리싱 실행 전 사용자가 입력한 추가 지시사항. */
  polishMessage?: string | undefined;
  /** 직렬화된 사용자 인라인 코멘트(target field만). serializeUserComments 결과. */
  userComments?: string | undefined;
  onToken?: (accumulatedText: string) => void;
  abortSignal?: AbortSignal | undefined;
}

export async function polishTargetDocumentWithStreaming(
  params: PolishTargetDocumentParams,
): Promise<{ doc: TipTapDocJson; raw: string }> {
  const { cfg, model, messages, maxTokens } = buildPolishMessages(params);

  if (params.abortSignal?.aborted) {
    throw new Error('폴리싱이 취소되었습니다.');
  }

  // Tauri 런타임에서는 백엔드 SSE 스트리밍을 1차 경로로 사용한다.
  if (isTauriRuntime() && cfg.provider !== 'mock') {
    const emitFiltered = (rawSoFar: string) => {
      const startIdx = rawSoFar.indexOf(POLISH_START);
      if (startIdx === -1) return;
      let filtered = rawSoFar.slice(startIdx + POLISH_START.length);
      const endIdx = filtered.indexOf(POLISH_END);
      if (endIdx !== -1) filtered = filtered.slice(0, endIdx);
      params.onToken?.(filtered.trim());
    };

    const raw = await streamWithTauriAiBackend({
      cfg,
      messages,
      maxTokens,
      onAccumulated: emitFiltered,
      cancelMessage: '폴리싱이 취소되었습니다.',
      abortSignal: params.abortSignal,
    });

    if (!raw.trim()) {
      throw new Error('폴리싱 응답이 비어 있습니다. 다시 시도해주세요.');
    }

    const { doc } = processPolishResponse(raw);
    return { doc, raw };
  }

  let accumulated = '';
  try {
    // WebView fetch의 CORS/네트워크 실패는 for-await 반복 도중 "Type error"로
    // 던져지므로 스트리밍 소비 전체를 try로 감싼다.
    const stream = await model.stream(messages, params.abortSignal ? { signal: params.abortSignal } : {});

    for await (const chunk of stream) {
      if (params.abortSignal?.aborted) {
        throw new Error('폴리싱이 취소되었습니다.');
      }

      const delta = typeof chunk.content === 'string'
        ? chunk.content
        : Array.isArray(chunk.content)
          ? chunk.content.map(c => typeof c === 'string' ? c : (c as { text?: string }).text || '').join('')
          : '';

      if (!delta) continue;

      accumulated += delta;
      const startIdx = accumulated.indexOf(POLISH_START);
      if (startIdx !== -1) {
        let filtered = accumulated.slice(startIdx + POLISH_START.length);
        const endIdx = filtered.indexOf(POLISH_END);
        if (endIdx !== -1) filtered = filtered.slice(0, endIdx);
        params.onToken?.(filtered.trim());
      }
    }
  } catch (error) {
    if (!shouldRetryWithTauriAiBackend(error)) {
      throw error;
    }
    const raw = await completeWithTauriAiBackend({
      cfg,
      messages,
      maxTokens,
      cancelMessage: '폴리싱이 취소되었습니다.',
      abortSignal: params.abortSignal,
    });
    const polishedMarkdown = extractPolishedMarkdown(raw);
    if (polishedMarkdown.trim()) {
      params.onToken?.(polishedMarkdown.trim());
    }
    const { doc } = processPolishResponse(raw);
    return { doc, raw };
  }

  if (!accumulated.trim()) {
    throw new Error('폴리싱 응답이 비어 있습니다. 다시 시도해주세요.');
  }

  const { doc } = processPolishResponse(accumulated);
  return { doc, raw: accumulated };
}
