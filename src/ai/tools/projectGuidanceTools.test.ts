import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ToolMessage } from '@langchain/core/messages';
import type { ForbiddenTerm, GlossaryEntry, ProjectMemoryItem } from '@/types';
import { createProjectGuidanceTools } from './projectGuidanceTools';
import { isToolAuditArtifact } from './toolAudit';

const mocks = vi.hoisted(() => ({ resolveGlossaryEntries: vi.fn() }));

vi.mock('@/utils/glossaryInject', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/glossaryInject')>()),
  resolveGlossaryEntries: mocks.resolveGlossaryEntries,
}));

function memory(id: string, overrides: Partial<ProjectMemoryItem> = {}): ProjectMemoryItem {
  return {
    id,
    projectId: 'project-1',
    category: 'general',
    content: `content of ${id}`,
    normalizedHash: id,
    status: 'active',
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function forbidden(id: string, overrides: Partial<ForbiddenTerm> = {}): ForbiddenTerm {
  return {
    id,
    projectId: 'project-1',
    term: `term-${id}`,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function guidanceTool(overrides: {
  projectMemoryItems?: ProjectMemoryItem[];
  forbiddenTerms?: ForbiddenTerm[];
} = {}): StructuredToolInterface {
  const [guidance] = createProjectGuidanceTools({
    projectId: 'project-1',
    translationRules: 'Use a formal tone.',
    projectMemoryItems: overrides.projectMemoryItems ?? [],
    forbiddenTerms: overrides.forbiddenTerms ?? [],
  });
  return guidance!;
}

/**
 * `content_and_artifact` 도구는 tool_call 형태로 호출해야 ToolMessage(+artifact)를 돌려준다.
 * `invoke(args)`는 artifact 없이 content만 돌려준다.
 */
async function callTool(tool: StructuredToolInterface, args: Record<string, unknown>) {
  const message = await tool.invoke({
    type: 'tool_call',
    id: 'call-1',
    name: tool.name,
    args,
  }) as ToolMessage;
  return {
    content: JSON.parse(String(message.content)) as Record<string, unknown>,
    artifact: message.artifact as unknown,
  };
}

describe('get_project_guidance', () => {
  it('모델용 content에는 메모리 id를 남기고, 금칙어 id는 artifact로만 넘긴다', async () => {
    const tool = guidanceTool({
      projectMemoryItems: [
        memory('memory-active', { category: 'audience', content: 'Enterprise administrators' }),
        memory('memory-proposed', { status: 'proposed', content: 'Unapproved context' }),
      ],
      forbiddenTerms: [
        forbidden('term-enabled', { term: 'easy', replacement: 'straightforward' }),
        forbidden('term-disabled', { term: 'simple', enabled: false }),
      ],
    });

    const { content, artifact } = await callTool(tool, {
      sections: ['project_memory', 'forbidden_terms'],
    });

    // propose_project_memory_change의 targetItemId는 이 id를 그대로 써야 하므로 모델이 볼 수 있어야 한다.
    expect(content.projectMemory).toEqual([
      { id: 'memory-active', category: 'audience', content: 'Enterprise administrators' },
    ]);
    // 금칙어 id는 모델이 쓸 곳이 없다 — 내용에서 빠진다.
    expect(content.forbiddenTerms).toEqual([{ term: 'easy', replacement: 'straightforward' }]);
    expect(JSON.stringify(content)).not.toContain('term-enabled');

    expect(isToolAuditArtifact(artifact)).toBe(true);
    expect(artifact).toEqual({
      projectMemoryItemIds: ['memory-active'],
      forbiddenTermIds: ['term-enabled'],
    });
  });

  it('요청하지 않은 섹션의 id는 artifact에 넣지 않는다', async () => {
    const tool = guidanceTool({
      projectMemoryItems: [memory('m1')],
      forbiddenTerms: [forbidden('t1')],
    });

    const memoryOnly = await callTool(tool, { sections: ['project_memory'] });
    expect(memoryOnly.artifact).toEqual({ projectMemoryItemIds: ['m1'] });
    expect(memoryOnly.content).not.toHaveProperty('forbiddenTerms');

    const forbiddenOnly = await callTool(tool, { sections: ['forbidden_terms'] });
    expect(forbiddenOnly.artifact).toEqual({ forbiddenTermIds: ['t1'] });
    expect(forbiddenOnly.content).not.toHaveProperty('projectMemory');
  });

  it('번역 규칙만 요청해도 튜플을 돌려주고 artifact에는 id가 없다', async () => {
    const tool = guidanceTool({
      projectMemoryItems: [memory('m1')],
      forbiddenTerms: [forbidden('t1')],
    });

    const { content, artifact } = await callTool(tool, { sections: ['translation_rules'] });

    expect(content).toEqual({ translationRules: 'Use a formal tone.' });
    expect(artifact).toEqual({});
  });

  it('조회 결과가 비어 있어도 빈 id 배열의 artifact를 돌려준다', async () => {
    const tool = guidanceTool();

    const { content, artifact } = await callTool(tool, {
      sections: ['project_memory', 'forbidden_terms'],
    });

    expect(content).toEqual({ forbiddenTerms: [], projectMemory: [] });
    expect(artifact).toEqual({ projectMemoryItemIds: [], forbiddenTermIds: [] });
  });

  it('query 필터와 30개 상한이 content와 artifact에 똑같이 적용된다', async () => {
    const many = Array.from({ length: 35 }, (_, index) => memory(`m${index}`, { content: 'glossary rule' }));
    const tool = guidanceTool({
      projectMemoryItems: [...many, memory('other', { content: 'unrelated' })],
    });

    const { content, artifact } = await callTool(tool, {
      sections: ['project_memory'],
      query: 'glossary',
    });

    const contentIds = (content.projectMemory as Array<{ id: string }>).map((item) => item.id);
    expect(contentIds).toHaveLength(30);
    expect(contentIds).not.toContain('other');
    // 감사 기록은 모델이 실제로 받은 항목과 일치해야 한다.
    expect(artifact).toEqual({ projectMemoryItemIds: contentIds });
  });

  it('invoke(args)로 직접 호출하면 content만 돌려준다 (artifact 없음)', async () => {
    const tool = guidanceTool({ projectMemoryItems: [memory('m1')] });

    const raw = await tool.invoke({ sections: ['project_memory'] });

    expect(typeof raw).toBe('string');
    expect(JSON.parse(String(raw)).projectMemory).toHaveLength(1);
  });
});

function glossaryEntry(partial: Partial<GlossaryEntry> & Pick<GlossaryEntry, 'id' | 'source' | 'target'>): GlossaryEntry {
  return {
    notes: null,
    domain: null,
    caseSensitive: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function glossaryTool(domain?: string | null): StructuredToolInterface {
  const tools = createProjectGuidanceTools({
    projectId: 'project-1',
    ...(domain === undefined ? {} : { domain }),
    translationRules: '',
    projectMemoryItems: [],
    forbiddenTerms: [],
  });
  return tools[1]!;
}

describe('search_project_glossary', () => {
  beforeEach(() => {
    mocks.resolveGlossaryEntries.mockReset();
    mocks.resolveGlossaryEntries.mockResolvedValue([]);
  });

  it('모델용 content에는 포맷된 용어 문자열만 담고, id는 artifact로만 넘긴다', async () => {
    mocks.resolveGlossaryEntries.mockResolvedValue([
      glossaryEntry({ id: 'g-1', source: 'Blue Zone', target: '블루존', notes: 'damage zone' }),
      glossaryEntry({ id: 'g-2', source: 'Bolt', target: '볼트', caseSensitive: true }),
    ]);

    const { content, artifact } = await callTool(glossaryTool(), { query: 'blue zone bolt' });

    expect(content).toEqual({
      glossary: [
        '- Blue Zone = 블루존 (damage zone)',
        '- Bolt = 볼트 (대소문자 구분, case-sensitive)',
      ].join('\n'),
    });
    // 중복(entries)이나 앱 전용 UUID가 모델에게 노출되지 않는다.
    expect(JSON.stringify(content)).not.toContain('g-1');
    expect(content).not.toHaveProperty('entries');

    expect(isToolAuditArtifact(artifact)).toBe(true);
    expect(artifact).toEqual({ glossaryEntryIds: ['g-1', 'g-2'] });
  });

  it('검색 결과가 없어도 튜플을 돌려준다', async () => {
    const { content, artifact } = await callTool(glossaryTool(), { query: 'nothing matches' });

    expect(content).toEqual({ glossary: '' });
    expect(artifact).toEqual({ glossaryEntryIds: [] });
  });

  it('프로젝트·도메인·질의를 검색에 넘기고 limit 기본값은 8이다', async () => {
    await callTool(glossaryTool('game'), { query: 'care package' });

    expect(mocks.resolveGlossaryEntries).toHaveBeenCalledWith({
      projectId: 'project-1',
      text: 'care package',
      domain: 'game',
      limit: 8,
    });
  });

  it('도메인이 없으면 domain 인자를 넘기지 않고, 지정한 limit을 그대로 쓴다', async () => {
    await callTool(glossaryTool(null), { query: 'care package', limit: 12 });

    const args = mocks.resolveGlossaryEntries.mock.calls[0]?.[0];
    expect(args).toEqual({ projectId: 'project-1', text: 'care package', limit: 12 });
    expect(args).not.toHaveProperty('domain');
  });

  it('limit이 12를 넘으면 검색하지 않고 거부한다', async () => {
    await expect(callTool(glossaryTool(), { query: 'care package', limit: 13 })).rejects.toThrow();
    expect(mocks.resolveGlossaryEntries).not.toHaveBeenCalled();
  });
});
