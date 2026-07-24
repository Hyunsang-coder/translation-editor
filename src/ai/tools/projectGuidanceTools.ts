import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { ForbiddenTerm, ProjectMemoryItem } from '@/types';
import {
  formatGlossaryForPrompt,
  resolveGlossaryEntries,
} from '@/utils/glossaryInject';

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
      if (parsed.sections.includes('translation_rules')) {
        output.translationRules = input.translationRules;
      }
      if (parsed.sections.includes('forbidden_terms')) {
        output.forbiddenTerms = input.forbiddenTerms
          .filter((term) => term.enabled)
          .filter((term) =>
            matchesQuery(
              [term.term, term.replacement, term.note].filter(Boolean).join(' '),
              parsed.query,
            ),
          )
          .slice(0, 30)
          .map(({ id, term, replacement, note }) => ({
            id,
            term,
            ...(replacement ? { replacement } : {}),
            ...(note ? { note } : {}),
          }));
      }
      if (parsed.sections.includes('project_memory')) {
        output.projectMemory = input.projectMemoryItems
          .filter((item) => item.status === 'active')
          .filter((item) => matchesQuery(item.content, parsed.query))
          .slice(0, 30)
          .map(({ id, category, content }) => ({ id, category, content }));
      }
      return JSON.stringify(output);
    },
    {
      name: 'get_project_guidance',
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
      return JSON.stringify({
        glossary: formatGlossaryForPrompt(entries),
        entries: entries.map(({ id, source, target }) => ({ id, source, target })),
      });
    },
    {
      name: 'search_project_glossary',
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
