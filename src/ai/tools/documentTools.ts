import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useProjectStore } from '@/stores/projectStore';
import { stripHtml } from '@/utils/hash';
import { buildSourceDocument } from '@/editor/sourceDocument';
import { buildTargetDocument } from '@/editor/targetDocument';
import { tipTapJsonToMarkdown, type TipTapDocJson } from '@/utils/markdownConverter';

/**
 * Source 문서를 Markdown 형식으로 반환
 * - TipTap JSON이 있으면 Markdown으로 변환 (서식 보존)
 * - 없으면 plain text fallback
 *
 * Issue #10 Fix: null 안전성 검사 및 의미 있는 에러 메시지
 */
function resolveSourceDocumentMarkdown(): string {
  const state = useProjectStore.getState();
  const { sourceDocJson, project, sourceDocument } = state;

  // Issue #10 Fix: 프로젝트가 로드되지 않은 경우 명확한 에러 메시지
  if (!project) {
    console.warn('[resolveSourceDocumentMarkdown] No project loaded');
    return '';
  }

  // TipTap JSON이 있으면 Markdown으로 변환
  if (sourceDocJson != null && typeof sourceDocJson === 'object' && sourceDocJson.type === 'doc') {
    try {
      return tipTapJsonToMarkdown(sourceDocJson as TipTapDocJson);
    } catch (e) {
      console.warn('[resolveSourceDocumentMarkdown] Markdown conversion failed, falling back to plain text:', e);
    }
  }

  // Fallback: plain text
  const raw = sourceDocument?.trim() ? sourceDocument : buildSourceDocument(project).text;
  return raw ? stripHtml(raw) : '';
}

/**
 * Target 문서를 Markdown 형식으로 반환
 * - TipTap JSON이 있으면 Markdown으로 변환 (서식 보존)
 * - 없으면 plain text fallback
 *
 * Issue #10 Fix: null 안전성 검사 및 의미 있는 에러 메시지
 */
function resolveTargetDocumentMarkdown(): string {
  const state = useProjectStore.getState();
  const { targetDocJson, project, targetDocument } = state;

  // Issue #10 Fix: 프로젝트가 로드되지 않은 경우 명확한 에러 메시지
  if (!project) {
    console.warn('[resolveTargetDocumentMarkdown] No project loaded');
    return '';
  }

  // TipTap JSON이 있으면 Markdown으로 변환
  if (targetDocJson != null && typeof targetDocJson === 'object' && targetDocJson.type === 'doc') {
    try {
      return tipTapJsonToMarkdown(targetDocJson as TipTapDocJson);
    } catch (e) {
      console.warn('[resolveTargetDocumentMarkdown] Markdown conversion failed, falling back to plain text:', e);
    }
  }

  // Fallback: plain text
  const raw = targetDocument?.trim() ? targetDocument : buildTargetDocument(project).text;
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
    const markdown = resolveSourceDocumentMarkdown();
    // Issue #10 Fix: 더 의미 있는 에러 메시지
    if (!markdown || markdown.trim().length === 0) {
      const { project } = useProjectStore.getState();
      if (!project) {
        throw new Error('프로젝트가 로드되지 않았습니다. 프로젝트를 먼저 열어주세요.');
      }
      throw new Error('원문 문서가 비어있습니다. Source 패널에 내용을 입력해주세요.');
    }
    return autoSliceLargeDocument(markdown, parsed);
  },
  {
    name: 'get_source_document',
    description:
      '원문(Source) 문서를 Markdown 형식으로 가져옵니다. 사용자가 문서 내용, 번역 품질, 표현에 대해 질문하면 먼저 이 도구를 호출하세요. 문서가 길면 자동으로 일부만 반환됩니다. 서식(헤딩, 리스트, 볼드 등)이 Markdown으로 표현됩니다.',
    schema: DocumentToolArgsSchema,
  },
);

export const getTargetDocumentTool = tool(
  async (rawArgs) => {
    const args = DocumentToolArgsSchema.safeParse(rawArgs ?? {});
    const parsed = args.success ? args.data : {};
    const markdown = resolveTargetDocumentMarkdown();
    // Issue #10 Fix: 더 의미 있는 에러 메시지
    if (!markdown || markdown.trim().length === 0) {
      const { project } = useProjectStore.getState();
      if (!project) {
        throw new Error('프로젝트가 로드되지 않았습니다. 프로젝트를 먼저 열어주세요.');
      }
      throw new Error('번역문 문서가 비어있습니다. 먼저 번역을 실행하거나 Target 패널에 내용을 입력해주세요.');
    }
    return autoSliceLargeDocument(markdown, parsed);
  },
  {
    name: 'get_target_document',
    description:
      '번역문(Target) 문서를 Markdown 형식으로 가져옵니다. 사용자가 번역 결과, 표현 자연스러움, 오역 여부에 대해 질문하면 먼저 이 도구를 호출하세요. 문서가 길면 자동으로 일부만 반환됩니다. 서식(헤딩, 리스트, 볼드 등)이 Markdown으로 표현됩니다.',
    schema: DocumentToolArgsSchema,
  },
);


