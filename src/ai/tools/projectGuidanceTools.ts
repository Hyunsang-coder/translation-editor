import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { ForbiddenTerm, ProjectMemoryItem } from '@/types';
import {
  formatGlossaryForPrompt,
  resolveGlossaryEntries,
} from '@/utils/glossaryInject';
import type { ToolAuditArtifact } from './toolAudit';

interface CreateProjectGuidanceToolsInput {
  projectId: string;
  domain?: string | null;
  translationRules: string;
  projectMemoryItems: ProjectMemoryItem[];
  forbiddenTerms: ForbiddenTerm[];
}

function normalizeQuery(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`]+/)
    .filter((token) => token.length >= 2);
}

function matchesQuery(content: string, query: string | undefined): boolean {
  if (!query?.trim()) return true;
  const haystack = content.toLocaleLowerCase();
  const tokens = normalizeQuery(query);
  return tokens.length === 0 || tokens.some((token) => haystack.includes(token));
}

export function createProjectGuidanceTools(
  input: CreateProjectGuidanceToolsInput,
): StructuredToolInterface[] {
  const guidance = tool(
    async (rawArgs) => {
      const parsed = z.object({
        sections: z.array(z.enum([
          'translation_rules',
          'forbidden_terms',
          'project_memory',
        ])).min(1).max(3),
        query: z.string().max(500).optional(),
      }).parse(rawArgs ?? {});

      const output: Record<string, unknown> = {};
      const audit: ToolAuditArtifact = {};
      if (parsed.sections.includes('translation_rules')) {
        output.translationRules = input.translationRules;
      }
      if (parsed.sections.includes('forbidden_terms')) {
        const terms = input.forbiddenTerms
          .filter((term) => term.enabled)
          .filter((term) =>
            matchesQuery(
              [term.term, term.replacement, term.note].filter(Boolean).join(' '),
              parsed.query,
            ),
          )
          .slice(0, 30);
        // 금칙어 id는 모델이 쓸 곳이 없다 — 감사용으로 artifact에만 싣는다.
        output.forbiddenTerms = terms.map(({ term, replacement, note }) => ({
          term,
          ...(replacement ? { replacement } : {}),
          ...(note ? { note } : {}),
        }));
        audit.forbiddenTermIds = terms.map(({ id }) => id);
      }
      if (parsed.sections.includes('project_memory')) {
        const items = input.projectMemoryItems
          .filter((item) => item.status === 'active')
          .filter((item) => matchesQuery(item.content, parsed.query))
          .slice(0, 30);
        // 메모리 id는 propose_project_memory_change의 targetItemId로 모델이 그대로 써야 하므로
        // content에 남기고, 감사용으로는 artifact에도 싣는다.
        output.projectMemory = items.map(({ id, category, content }) => ({ id, category, content }));
        audit.projectMemoryItemIds = items.map(({ id }) => id);
      }
      const result: [string, ToolAuditArtifact] = [JSON.stringify(output), audit];
      return result;
    },
    {
      name: 'get_project_guidance',
      responseFormat: 'content_and_artifact',
      description:
        '필요한 프로젝트 번역 규칙, 금칙어, 승인된 프로젝트 메모리만 선택해서 조회합니다.',
      schema: z.object({
        sections: z.array(z.enum([
          'translation_rules',
          'forbidden_terms',
          'project_memory',
        ])).min(1).max(3),
        query: z.string().max(500).optional(),
      }),
    },
  );

  const glossary = tool(
    async (rawArgs) => {
      const parsed = z.object({
        query: z.string().min(1).max(1_000),
        limit: z.number().int().min(1).max(12).optional(),
      }).parse(rawArgs ?? {});
      const entries = await resolveGlossaryEntries({
        projectId: input.projectId,
        text: parsed.query,
        ...(input.domain ? { domain: input.domain } : {}),
        limit: parsed.limit ?? 8,
      });
      // 모델은 포맷된 문자열(원문·번역·노트·대소문자 표시)만 있으면 된다.
      // 항목 id는 앱의 감사 기록용이라 artifact로만 넘긴다.
      const result: [string, ToolAuditArtifact] = [
        JSON.stringify({ glossary: formatGlossaryForPrompt(entries) }),
        { glossaryEntryIds: entries.map(({ id }) => id) },
      ];
      return result;
    },
    {
      name: 'search_project_glossary',
      responseFormat: 'content_and_artifact',
      description:
        '현재 질문이나 선택 문구에 관련된 프로젝트 용어집 항목만 검색합니다.',
      schema: z.object({
        query: z.string().min(1).max(1_000),
        limit: z.number().int().min(1).max(12).optional(),
      }),
    },
  );

  return [guidance, glossary];
}
