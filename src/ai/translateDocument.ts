import type { ChatMessage, ITEProject } from '@/types';
import { createChatModel } from '@/ai/client';
import { getAiConfig } from '@/ai/config';

export type TipTapDocJson = Record<string, unknown>;

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

function extractJsonObject(raw: string): string {
  let t = raw.trim();
  // 흔한 케이스: ```json ... ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return t.slice(first, last + 1);
  }
  return t;
}

function isTipTapDocJson(v: unknown): v is TipTapDocJson {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return obj.type === 'doc' && Array.isArray(obj.content);
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

  const srcLang = params.project.metadata.sourceLanguage ?? 'Source';
  const tgtLang = params.project.metadata.targetLanguage ?? 'Target';

  const systemLines: string[] = [
    '당신은 전문 번역가입니다.',
    `아래에 제공되는 TipTap/ProseMirror 문서 JSON의 텍스트를 ${srcLang}에서 ${tgtLang}로 번역하세요.`,
    '',
    '중요: 출력은 반드시 "단 하나의 JSON 객체"만 반환하세요.',
    '- 마크다운, 코드펜스(```), 설명, 인사, 부연, HTML을 절대 출력하지 마세요.',
    '- 최상단은 ProseMirror doc 스키마를 유지해야 합니다. (예: {"type":"doc","content":[...]})',
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
  const res = await model.invoke([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        '다음 JSON 문서를 번역하여 동일 스키마의 JSON으로만 반환하세요.',
        '',
        // JSON을 사람이 읽는 프롬프트로 감싸면 모델이 실수로 텍스트를 붙일 수 있어,
        // 최대한 단순하게 전달합니다.
        JSON.stringify(params.sourceDocJson),
      ].join('\n'),
    },
  ]);

  const raw = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  const extracted = extractJsonObject(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    throw new Error('번역 결과 JSON 파싱에 실패했습니다. (모델이 JSON 이외의 텍스트를 출력했을 수 있습니다)');
  }

  // 에러 객체 반환 프로토콜
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


