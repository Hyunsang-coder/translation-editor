// PPTX 슬라이드별 번역 로직

import { getAiConfig } from '@/ai/config';
import { createChatModel } from '@/ai/client';
import i18n from '@/i18n/config';

export interface TranslateSlideOptions {
  texts: string[]; // 슬라이드 내 텍스트들
  sourceLanguage: string;
  targetLanguage: string;
  domain?: string | undefined;
  glossaryTerms?: Array<{ source: string; target: string }> | undefined;
  signal?: AbortSignal | undefined;
}

export interface TranslateSlideResult {
  translatedTexts: string[];
}

/**
 * 단일 슬라이드의 텍스트들을 번역
 * - 한 슬라이드의 모든 텍스트를 한 번의 API 호출로 처리
 * - 원본 텍스트 배열과 동일한 순서/개수의 번역 결과 반환
 */
export async function translateSlide(
  options: TranslateSlideOptions
): Promise<TranslateSlideResult> {
  const { texts, sourceLanguage, targetLanguage, domain, glossaryTerms, signal } = options;

  // 빈 텍스트 필터링 및 인덱스 추적
  const nonEmptyTexts = texts
    .map((t, i) => ({ text: t.trim(), originalIndex: i }))
    .filter((item) => item.text.length > 0);

  if (nonEmptyTexts.length === 0) {
    return { translatedTexts: texts.map(() => '') };
  }

  // AI 설정 가져오기
  const cfg = getAiConfig({ useFor: 'translation' });

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

  // 프롬프트 구성
  const systemPrompt = buildSystemPrompt(sourceLanguage, targetLanguage, domain, glossaryTerms);
  const userPrompt = buildUserPrompt(nonEmptyTexts.map((t) => t.text));

  // LangChain 모델 생성
  const model = createChatModel(undefined, {
    useFor: 'translation',
    maxTokens: 8192,
  });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  // 취소 확인
  if (signal?.aborted) {
    throw new Error('번역이 취소되었습니다.');
  }

  // API 호출
  const invokeOptions = signal ? { signal } : {};
  const res = await model.invoke(messages, invokeOptions);

  // 응답 텍스트 추출
  const rawContent = res.content;
  const raw =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((c) => (typeof c === 'string' ? c : (c as { text?: string }).text || '')).join('')
        : String(rawContent);

  // 응답이 비어있는 경우
  if (!raw || raw.trim().length === 0) {
    throw new Error('번역 응답이 비어 있습니다. 모델이 응답을 생성하지 못했습니다.');
  }

  // JSON 배열 파싱
  const translations = parseTranslationResponse(raw, nonEmptyTexts.length);

  // 결과를 원래 순서로 복원
  const translatedTexts = texts.map(() => '');
  nonEmptyTexts.forEach((item, i) => {
    translatedTexts[item.originalIndex] = translations[i] || '';
  });

  return { translatedTexts };
}

function buildSystemPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  domain?: string,
  glossaryTerms?: Array<{ source: string; target: string }>
): string {
  const lines: string[] = [
    'You are a professional translator specializing in presentation content.',
    `Translate the following texts from ${sourceLanguage} to ${targetLanguage}.`,
    '',
  ];

  if (domain) {
    lines.push(`The content is in the ${domain} domain. Use appropriate terminology.`, '');
  }

  if (glossaryTerms && glossaryTerms.length > 0) {
    lines.push('Use these glossary terms consistently:');
    glossaryTerms.forEach((term) => {
      lines.push(`- "${term.source}" -> "${term.target}"`);
    });
    lines.push('');
  }

  lines.push(
    '=== OUTPUT FORMAT ===',
    'Return the translations as a JSON array of strings.',
    'The array MUST have the EXACT same number of elements as the input.',
    'Maintain the same order as the input.',
    '',
    'Example input: ["Hello", "World"]',
    'Example output: ["안녕하세요", "세계"]',
    '',
    '=== TRANSLATION RULES ===',
    '- Preserve any special formatting (line breaks, punctuation)',
    '- Keep numbers, URLs, and technical terms unchanged unless translation is required',
    '- Maintain the tone and style of the original text',
    '- For proper nouns, keep the original unless a standard translation exists',
    '',
    'IMPORTANT: Output ONLY the JSON array, nothing else.'
  );

  return lines.join('\n');
}

function buildUserPrompt(texts: string[]): string {
  return JSON.stringify(texts);
}

/**
 * AI 응답에서 번역된 텍스트 배열을 추출
 */
function parseTranslationResponse(raw: string, expectedCount: number): string[] {
  // JSON 배열 추출 시도
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('번역 응답에서 JSON 배열을 찾을 수 없습니다.');
  }

  let translations: unknown;
  try {
    translations = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('번역 응답 JSON 파싱에 실패했습니다.');
  }

  if (!Array.isArray(translations)) {
    throw new Error('번역 응답이 배열 형식이 아닙니다.');
  }

  // 문자열 배열로 변환
  const result = translations.map((item) => (typeof item === 'string' ? item : String(item)));

  // 개수 검증 (경고만, 에러는 아님)
  if (result.length !== expectedCount) {
    console.warn(
      `[translateSlide] 번역 결과 개수 불일치: 예상 ${expectedCount}, 실제 ${result.length}`
    );
  }

  return result;
}

/**
 * 전체 PPTX 번역 오케스트레이터
 * - 슬라이드별로 순차 번역
 * - 진행 상황 콜백
 * - 취소 지원
 */
export async function translatePptx(options: {
  slides: Array<{ index: number; texts: string[] }>;
  sourceLanguage: string;
  targetLanguage: string;
  domain?: string | undefined;
  glossaryTerms?: Array<{ source: string; target: string }> | undefined;
  signal?: AbortSignal | undefined;
  onSlideStart?: ((index: number) => void) | undefined;
  onSlideComplete?: ((index: number, translatedTexts: string[]) => void) | undefined;
  onSlideError?: ((index: number, error: Error) => void) | undefined;
}): Promise<void> {
  const {
    slides,
    sourceLanguage,
    targetLanguage,
    domain,
    glossaryTerms,
    signal,
    onSlideStart,
    onSlideComplete,
    onSlideError,
  } = options;

  for (const slide of slides) {
    // 취소 확인
    if (signal?.aborted) {
      break;
    }

    onSlideStart?.(slide.index);

    try {
      const result = await translateSlide({
        texts: slide.texts,
        sourceLanguage,
        targetLanguage,
        domain,
        glossaryTerms,
        signal,
      });

      onSlideComplete?.(slide.index, result.translatedTexts);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        break;
      }
      onSlideError?.(slide.index, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
