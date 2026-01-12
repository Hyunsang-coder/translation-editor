import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { stripHtml } from '@/utils/hash';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';

function resolveSourceDocumentText(): string {
  const { project, sourceDocument } = useProjectStore.getState();
  const raw = sourceDocument?.trim() ? sourceDocument : project ? buildSourceDocument(project).text : '';
  return raw ? stripHtml(raw) : '';
}

function resolveTargetDocumentText(): string {
  const { project, targetDocument } = useProjectStore.getState();
  const raw = targetDocument?.trim() ? targetDocument : project ? buildTargetDocument(project).text : '';
  return raw ? stripHtml(raw) : '';
}

// 큰 문서(토큰 폭발 위험)에서만 자동으로 잘라서 반환하는 옵션
// - 기본 호출({})은 "짧으면 전체, 길면 truncate" (auto)
// - query는 문서가 아주 길 때만 주변 발췌에 사용합니다.
const DocumentToolArgsSchema = z.object({
  query: z.string().optional().describe('문서가 매우 길 때, 이 구절 주변만 발췌하고 싶으면 사용'),
  maxChars: z.number().int().min(1000).max(20000).optional().describe('문서가 길 때 반환할 최대 문자 수 (기본 8000)'),
  aroundChars: z.number().int().min(200).max(4000).optional().describe('query 주변 발췌 범위(문자) (기본 900)'),
});

type DocumentToolArgs = z.infer<typeof DocumentToolArgsSchema>;

function autoSliceLargeDocument(text: string, args: DocumentToolArgs): string {
  const t = text ?? '';
  const maxChars = args.maxChars ?? 8000;
  if (t.length <= maxChars) return t;

  const query = args.query?.trim();
  const around = args.aroundChars ?? 900;

  // 아주 큰 문서일 때만 query 주변 발췌를 시도
  if (query) {
    const idx = t.indexOf(query);
    if (idx >= 0) {
      const start = Math.max(0, idx - around);
      const end = Math.min(t.length, idx + query.length + around);
      const chunk = t.slice(start, end);
      return chunk.length <= maxChars ? chunk : chunk.slice(0, maxChars);
    }
  }

  // query가 없거나 못 찾으면: head+tail (문서 앞/뒤 맥락 모두 조금 확보)
  const marker = '\n...\n';
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.floor(budget * 0.62);
  const tailLen = Math.max(0, budget - headLen);
  const head = t.slice(0, headLen);
  const tail = tailLen > 0 ? t.slice(Math.max(0, t.length - tailLen)) : '';
  return `${head}${marker}${tail}`;
}

export const getSourceDocumentTool = tool(
  async (rawArgs) => {
    const args = DocumentToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const text = resolveSourceDocumentText();
    if (!text || text.trim().length === 0) {
      throw new Error('원문 문서가 비어있습니다.');
    }
    return autoSliceLargeDocument(text, parsed);
  },
  {
    name: 'get_source_document',
    description:
      '원문(Source) 문서를 가져옵니다. 사용자가 문서 내용, 번역 품질, 표현에 대해 질문하면 먼저 이 도구를 호출하세요. 문서가 길면 자동으로 일부만 반환됩니다.',
    schema: DocumentToolArgsSchema,
  },
);

export const getTargetDocumentTool = tool(
  async (rawArgs) => {
    const args = DocumentToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const text = resolveTargetDocumentText();
    if (!text || text.trim().length === 0) {
      throw new Error('번역문 문서가 비어있습니다.');
    }
    return autoSliceLargeDocument(text, parsed);
  },
  {
    name: 'get_target_document',
    description:
      '번역문(Target) 문서를 가져옵니다. 사용자가 번역 결과, 표현 자연스러움, 오역 여부에 대해 질문하면 먼저 이 도구를 호출하세요. 문서가 길면 자동으로 일부만 반환됩니다.',
    schema: DocumentToolArgsSchema,
  },
);


