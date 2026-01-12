import type { ITEProject } from '@/types';
import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';
import i18n from '@/i18n/config';
import { z } from 'zod';

export type TipTapDocJson = Record<string, unknown>;

// ============================================================
// Structured Output 스키마 정의
// ============================================================

// TipTap doc content 스키마 (재귀 구조)
const TipTapNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.string(),
    content: z.array(TipTapNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(z.record(z.unknown())).optional(),
    attrs: z.record(z.unknown()).optional(),
  }).passthrough()
);

const TranslationResultSchema = z.object({
  doc: z.object({
    type: z.literal('doc'),
    content: z.array(TipTapNodeSchema),
  }).passthrough().nullable(),
  error: z.string().optional(),
});

// ============================================================
// 동적 토큰 계산 및 truncation 감지
// ============================================================

/**
 * 텍스트 기반 토큰 수 추정
 * - 영어: 약 4자 = 1토큰
 * - 한글: 약 2자 = 1토큰
 * - JSON 구조 오버헤드 약 20% 추가
 */
function estimateTokenCount(text: string): number {
  const chars = text.length;
  // 평균적으로 3자당 1토큰으로 추정 (한영 혼용 고려)
  const estimatedTokens = Math.ceil(chars / 3);
  // JSON 구조 오버헤드 20% 추가
  return Math.ceil(estimatedTokens * 1.2);
}

/**
 * 개선된 truncation 감지
 */
function detectTruncation(raw: string): { isTruncated: boolean; reason?: string } {
  const openBrace = (raw.match(/\{/g) || []).length;
  const closeBrace = (raw.match(/\}/g) || []).length;
  const openBracket = (raw.match(/\[/g) || []).length;
  const closeBracket = (raw.match(/\]/g) || []).length;

  if (openBrace > closeBrace) {
    return { isTruncated: true, reason: `Unmatched braces: ${openBrace} open, ${closeBrace} close` };
  }
  if (openBracket > closeBracket) {
    return { isTruncated: true, reason: `Unmatched brackets: ${openBracket} open, ${closeBracket} close` };
  }

  // 문자열 내부에서 끊긴 경우 감지
  const lastQuote = raw.lastIndexOf('"');
  if (lastQuote > 0) {
    const afterQuote = raw.slice(lastQuote + 1).trim();
    // 정상적인 JSON이라면 " 뒤에 ,}] 중 하나가 와야 함
    if (afterQuote.length === 0 || !/^[,}\]]/.test(afterQuote)) {
      return { isTruncated: true, reason: 'Response ends mid-string' };
    }
  }

  return { isTruncated: false };
}

/**
 * 재시도 가능한 번역 에러인지 판단
 */
export function isRetryableTranslationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();

  // 재시도 가능한 에러:
  // - 응답 잘림 (truncation)
  // - JSON 파싱 실패
  // - 빈 응답
  // - 네트워크/타임아웃 에러
  return (
    msg.includes('파싱') ||
    msg.includes('비어') ||
    msg.includes('truncat') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('translationpreviewerror') ||
    msg.includes('unmatched') ||
    msg.includes('mid-string')
  );
}

function extractFirstJsonObject(raw: string): string | null {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractJsonObject(raw: string): string {
  let t = raw.trim();
  
  // 1) 코드펜스 제거 (```json ... ``` 또는 ``` ... ```)
  // 여러 코드펜스가 있을 수 있으므로 전역 제거
  t = t.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  
  // 2) 응답에 앞/뒤 설명이 붙거나, 내부에 여분의 중괄호가 섞여 있을 때
  // 첫 번째로 닫히는 JSON 오브젝트만 안전하게 잘라냅니다.
  const balanced = extractFirstJsonObject(t);
  if (balanced) return balanced.trim();

  // 3) Fallback: 첫 { 부터 마지막 } 까지
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return t.slice(first, last + 1).trim();
  }
  
  return t;
}

function isTipTapDocJson(v: unknown): v is TipTapDocJson {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return obj.type === 'doc' && Array.isArray(obj.content);
}

function contentToText(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((c) => {
        if (!c) return '';
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && 'text' in c && typeof (c as { text?: unknown }).text === 'string') {
          return (c as { text: string }).text;
        }
        return '';
      })
      .filter((t) => t.trim().length > 0);
    if (texts.length > 0) {
      return texts.join('\n');
    }
  }
  return JSON.stringify(content);
}

/**
 * Source 전체를 TipTap JSON 형태로 번역합니다. (서식/구조 보존)
 * - 모델 출력은 "JSON만" 강제
 * - 번역(Translate) 모드는 채팅 히스토리를 컨텍스트에 포함하지 않습니다.
 */
export async function translateSourceDocToTargetDocJson(params: {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  translationRules?: string;
  projectContext?: string;
  translatorPersona?: string;
}): Promise<{ doc: TipTapDocJson; raw: string }> {
  const cfg = getAiConfig();

  // mock provider는 더 이상 지원하지 않음 - 실제 API 호출 필요
  if (cfg.provider === 'mock') {
    throw new Error('Mock provider는 더 이상 지원되지 않습니다. OpenAI API 키를 설정해주세요.');
  }

  const srcLang = 'Source';
  const tgtLang = params.project.metadata.targetLanguage ?? 'Target';

  const persona = params.translatorPersona?.trim()
    ? params.translatorPersona
    : '당신은 경험많은 전문 번역가입니다.';

  const systemLines: string[] = [
    persona,
    `아래에 제공되는 TipTap/ProseMirror 문서 JSON의 텍스트를 ${srcLang}에서 ${tgtLang}로 자연스럽게 번역하세요.`,
    '',
    '=== 중요: 출력 형식 ===',
    '반드시 아래 형태의 "단 하나의 JSON 객체"만 출력하세요:',
    '',
    '성공 시:',
    '{"doc": {"type":"doc","content":[...]}}',
    '',
    '실패 시:',
    '{"error": "사유 설명", "doc": null}',
    '',
    '절대 금지 사항:',
    '- 코드펜스(```json, ```) 사용 금지',
    '- 마크다운 포맷 사용 금지',
    '- "번역 결과입니다", "다음과 같이 번역했습니다" 등의 설명문 금지',
    '- HTML, 인사말, 부연 설명 금지',
    '- 오직 위 JSON 객체만 출력',
    '',
    '=== 번역 규칙 ===',
    '- 성공 시 doc는 ProseMirror doc 스키마를 유지해야 합니다.',
    '- 문서 구조/서식(heading/list/marks/link 등)은 그대로 유지하고, 텍스트 노드의 내용만 번역하세요.',
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

  const systemPrompt = systemLines.join('\n').trim();

  // ============================================================
  // 동적 max_tokens 계산
  // ============================================================
  const inputJson = JSON.stringify(params.sourceDocJson);
  const estimatedInputTokens = estimateTokenCount(inputJson);
  const systemPromptTokens = estimateTokenCount(systemPrompt);
  const totalInputTokens = estimatedInputTokens + systemPromptTokens;

  // GPT-5 컨텍스트 윈도우: 400k, 안전 마진 10%
  const MAX_CONTEXT = 400_000;
  const SAFETY_MARGIN = 0.9;
  const availableOutputTokens = Math.floor((MAX_CONTEXT * SAFETY_MARGIN) - totalInputTokens);

  // 최소 출력 토큰 보장 (입력보다 약간 많게 - 번역 시 텍스트가 늘어날 수 있음)
  const minOutputTokens = Math.max(estimatedInputTokens * 1.5, 8192);
  const calculatedMaxTokens = Math.max(minOutputTokens, Math.min(availableOutputTokens, 65536));

  // 입력이 너무 큰 경우 사전 에러
  if (availableOutputTokens < minOutputTokens) {
    throw new Error(
      `문서가 너무 큽니다. 예상 입력: ${totalInputTokens.toLocaleString()} 토큰, ` +
      `최대 허용: ${Math.floor(MAX_CONTEXT * 0.6).toLocaleString()} 토큰. ` +
      `문서를 분할하여 번역해주세요.`
    );
  }

  const model = createChatModel(undefined, { useFor: 'translation', maxTokens: calculatedMaxTokens });

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        '아래 JSON 문서를 번역하여, 위에서 지정한 형태의 JSON 객체로만 반환하세요.',
        '',
        '입력 문서:',
        JSON.stringify(params.sourceDocJson),
        '',
        '다시 한 번 강조: 설명 없이 {"doc": {...}} 형태의 JSON만 출력하세요.',
      ].join('\n'),
    },
  ];

  // 1) 1차: LangChain structured output (OpenAI JSON/tool calling 등)로 파싱 안정화
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (model as any).withStructuredOutput(TranslationResultSchema, {
      name: 'translate_doc',
      strict: false,
      includeRaw: true,
    });
    const structuredRes = await structured.invoke(messages);

    // includeRaw: true일 때 { raw: AIMessage, parsed: {...} } 형태로 반환됨
    const parsed = structuredRes?.parsed;
    const rawMessage = structuredRes?.raw;
    const rawContent = contentToText(rawMessage?.content);

    if (parsed) {
      // 에러 응답 처리
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        throw new Error(parsed.error);
      }

      // 성공적으로 파싱된 경우
      if (parsed.doc && isTipTapDocJson(parsed.doc)) {
        return { doc: parsed.doc, raw: rawContent || JSON.stringify(parsed.doc) };
      }
    }

    // parsed가 없거나 doc가 유효하지 않으면 폴백으로 진행
    console.warn('Structured output parsed but doc invalid, falling back to text parsing');
  } catch (e) {
    // Structured output 자체가 실패한 경우 폴백
    console.warn('Structured output failed, falling back to text parsing:', e);
  }

  // 2) 폴백: 기존 문자열 파싱
  const res = await model.invoke(messages);
  const raw = contentToText((res as { content?: unknown })?.content);
  
  // 응답이 비어있는 경우
  if (!raw || raw.trim().length === 0) {
    throw new Error('번역 응답이 비어 있습니다. 모델이 응답을 생성하지 못했습니다.');
  }
  
  const extracted = extractJsonObject(raw);

  let parsed: unknown;
  let lastError: unknown;
  const candidates = [extracted, extracted !== raw ? raw : null].filter(
    (c): c is string => typeof c === 'string' && c.length > 0,
  );

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    // 개선된 truncation 감지
    const truncation = detectTruncation(raw);

    if (truncation.isTruncated) {
      throw new Error(
        `${i18n.t('errors.translationPreviewError')}\n` +
        `응답이 잘렸습니다: ${truncation.reason}\n` +
        `다시 시도해주세요.`
      );
    }

    // 디버깅을 위해 실제 응답 내용의 일부를 에러 메시지에 포함
    const preview = raw.slice(0, 300).replace(/\n/g, ' ');
    throw new Error(
      `번역 결과 JSON 파싱에 실패했습니다. (모델이 JSON 이외의 텍스트를 출력했을 수 있습니다)\n\n응답 미리보기: ${preview}...`,
    );
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.error === 'string') {
      throw new Error(obj.error);
    }
    if (obj.doc && isTipTapDocJson(obj.doc)) {
      return { doc: obj.doc, raw };
    }
  }

  if (!isTipTapDocJson(parsed)) {
    throw new Error('번역 결과가 TipTap doc JSON 형식이 아닙니다.');
  }

  return { doc: parsed, raw };
}


