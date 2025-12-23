import type { ChatMessage, ITEProject } from '@/types';
import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';
import { z } from 'zod';

export type TipTapDocJson = Record<string, unknown>;

const TipTapDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.unknown()),
  })
  .passthrough();

const TranslationResultSchema = z.union([
  z
    .object({
      doc: TipTapDocSchema,
      error: z.undefined().optional(),
    })
    .passthrough(),
  z
    .object({
      error: z.string(),
      doc: z.null(),
    })
    .passthrough(),
]);

function formatRecentChat(messages: ChatMessage[], maxN: number): string {
  const sliced = messages.slice(Math.max(0, messages.length - maxN));
  if (sliced.length === 0) return '';

  const lines: string[] = ['[최근 채팅(최신 10개)]'];
  for (const m of sliced) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = (m.content ?? '').trim().replace(/\s+/g, ' ');
    if (!text) continue;
    // 너무 길면 잘라서 토큰 폭발 방지
    lines.push(`${role}: ${text.slice(0, 240)}${text.length > 240 ? '…' : ''}`);
  }
  return lines.join('\n');
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
  // 흔한 케이스: ```json ... ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

  // 응답에 앞/뒤 설명이 붙거나, 내부에 여분의 중괄호가 섞여 있을 때
  // 첫 번째로 닫히는 JSON 오브젝트만 안전하게 잘라냅니다.
  const balanced = extractFirstJsonObject(t);
  if (balanced) return balanced.trim();

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
 * - 최근 채팅 10개를 컨텍스트로 포함 (톤/용어/스타일 반영)
 */
export async function translateSourceDocToTargetDocJson(params: {
  project: ITEProject;
  sourceDocJson: TipTapDocJson;
  recentChatMessages?: ChatMessage[];
  translationRules?: string;
  activeMemory?: string;
}): Promise<{ doc: TipTapDocJson; raw: string }> {
  const cfg = getAiConfig();

  if (cfg.provider === 'mock') {
    // mock은 실제 번역 대신 "그대로 반환"하여 파이프라인 테스트 가능하게 함
    return { doc: params.sourceDocJson, raw: JSON.stringify(params.sourceDocJson) };
  }

  const srcLang = 'Source';
  const tgtLang = params.project.metadata.targetLanguage ?? 'Target';

  const systemLines: string[] = [
    '당신은 경험많은 전문 번역가입니다.',
    `아래에 제공되는 TipTap/ProseMirror 문서 JSON의 텍스트를 ${srcLang}에서 ${tgtLang}로 자연스럽게 번역하세요.`,
    '',
    '중요: 출력은 반드시 "단 하나의 JSON 객체"만 반환하세요.',
    '- 마크다운, 코드펜스(```), 설명, 인사, 부연, HTML을 절대 출력하지 마세요.',
    '- 출력 JSON은 다음 형태 중 하나여야 합니다:',
    '  - 성공: {"doc": {"type":"doc","content":[...]} }',
    '  - 실패: {"error": "사유", "doc": null }',
    '- 성공 시 doc는 ProseMirror doc 스키마를 유지해야 합니다. (예: {"type":"doc","content":[...]})',
    '- 문서 구조/서식(heading/list/marks/link 등)은 그대로 유지하고, 텍스트 노드의 내용만 번역하세요.',
    '- 링크 URL(href), 숫자, 코드/태그/변수(예: {var}, <tag>, %s)는 그대로 유지하세요.',
    '- 불확실하면 임의로 꾸미지 말고 원문 표현을 최대한 보존하세요.',
    '',
  ];

  const rules = params.translationRules?.trim();
  if (rules) {
    systemLines.push('[번역 규칙]', rules, '');
  }

  const memory = params.activeMemory?.trim();
  if (memory) {
    systemLines.push('[Active Memory - 용어/톤 규칙]', memory, '');
  }

  const recent = formatRecentChat(params.recentChatMessages ?? [], 10);
  if (recent) {
    systemLines.push(recent, '');
  }

  const systemPrompt = systemLines.join('\n').trim();

  const model = createChatModel();

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        '다음 JSON 문서를 번역하여, 위에서 지정한 형태의 JSON 객체로만 반환하세요.',
        '',
        // JSON을 사람이 읽는 프롬프트로 감싸면 모델이 실수로 텍스트를 붙일 수 있어,
        // 최대한 단순하게 전달합니다.
        JSON.stringify(params.sourceDocJson),
      ].join('\n'),
    },
  ];

  // 1) 1차: LangChain structured output (OpenAI JSON/tool calling 등)로 파싱 안정화
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (model as any).withStructuredOutput(TranslationResultSchema, {
      name: 'translate_doc',
      strict: true,
      includeRaw: true,
    });
    const res = await structured.invoke(messages);

    const parsed = (res && typeof res === 'object' && 'parsed' in res)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (res as any).parsed
      : res;
    const raw = (res && typeof res === 'object' && 'raw' in res)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? JSON.stringify((res as any).raw)
      : JSON.stringify(res);

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { error?: unknown; doc?: unknown };
      if (typeof obj.error === 'string') throw new Error(obj.error);
      if (obj.doc && isTipTapDocJson(obj.doc)) {
        return { doc: obj.doc, raw };
      }
      if (obj.doc === null && typeof obj.error === 'string') {
        throw new Error(obj.error);
      }
    }

    throw new Error('번역 결과가 TipTap doc JSON 형식이 아닙니다.');
  } catch {
    // 2) 폴백: 기존 문자열 파싱 (provider/모델이 structured output을 지원하지 않는 경우)
    const res = await model.invoke(messages);
    const raw = contentToText((res as { content?: unknown })?.content);
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
      throw new Error(
        '번역 결과 JSON 파싱에 실패했습니다. (모델이 JSON 이외의 텍스트를 출력했을 수 있습니다)',
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
}


