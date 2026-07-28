import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const proposeSelectionEdit = tool(
  async () => ({ ok: true }),
  {
    name: 'propose_selection_edit',
    description:
      '현재 Target 선택 영역의 수정안을 구조화해 제안합니다. 문서는 변경하지 않으며 사용자가 별도로 승인해야 합니다.',
    schema: z.object({
      replacementText: z.string().min(1).max(10_000),
      explanation: z.string().max(2_000).optional(),
      operation: z.enum(['translate', 'polish', 'rewrite']).optional(),
    }),
  },
);

export const proposeProjectMemoryChange = tool(
  async () => ({ ok: true }),
  {
    name: 'propose_project_memory_change',
    description:
      '다음 대화와 번역 작업에도 유지할 프로젝트 메모리 변경을 제안합니다. 직접 저장하지 않습니다.',
    schema: z.object({
      operation: z.enum(['add', 'replace', 'delete']),
      category: z.enum([
        'domain',
        'audience',
        'product',
        'worldbuilding',
        'character',
        'intent',
        'decision',
        'reference_fact',
        'general',
      ]),
      content: z.string().min(1).max(5_000).optional(),
      targetItemId: z.string().optional(),
      reason: z.string().max(2_000).optional(),
    }),
  },
);

export const suggestForbiddenTerm = tool(
  async () => ({ ok: true }),
  {
    name: 'suggest_forbidden_term',
    description: '프로젝트 금칙어를 제안합니다. 사용자가 승인하기 전에는 저장하지 않습니다.',
    schema: z.object({
      term: z.string().min(1).max(500),
      replacement: z.string().max(500).optional(),
      note: z.string().max(1_000).optional(),
    }),
  },
);

export const suggestGlossaryEntry = tool(
  async () => ({ ok: true }),
  {
    name: 'suggest_glossary_entry',
    description: '프로젝트 용어집 항목을 제안합니다. 사용자가 승인하기 전에는 저장하지 않습니다.',
    schema: z.object({
      source: z.string().min(1).max(500),
      target: z.string().min(1).max(500),
      notes: z.string().max(1_000).optional(),
    }),
  },
);
