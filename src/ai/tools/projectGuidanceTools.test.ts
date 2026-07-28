import { describe, expect, it } from 'vitest';
import { createProjectGuidanceTools } from './projectGuidanceTools';

describe('project guidance tools', () => {
  it('active memory와 enabled forbidden term의 감사 ID를 함께 반환한다', async () => {
    const [guidance] = createProjectGuidanceTools({
      projectId: 'project-1',
      translationRules: 'Use a formal tone.',
      projectMemoryItems: [
        {
          id: 'memory-active',
          projectId: 'project-1',
          category: 'audience',
          content: 'Enterprise administrators',
          normalizedHash: 'a',
          status: 'active',
          source: 'user',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'memory-proposed',
          projectId: 'project-1',
          category: 'general',
          content: 'Unapproved context',
          normalizedHash: 'b',
          status: 'proposed',
          source: 'user',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      forbiddenTerms: [
        {
          id: 'term-enabled',
          projectId: 'project-1',
          term: 'easy',
          replacement: 'straightforward',
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'term-disabled',
          projectId: 'project-1',
          term: 'simple',
          enabled: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const output = JSON.parse(String(await guidance!.invoke({
      sections: ['project_memory', 'forbidden_terms'],
    }))) as {
      projectMemory: Array<{ id: string }>;
      forbiddenTerms: Array<{ id: string }>;
    };
    expect(output.projectMemory.map((item) => item.id)).toEqual(['memory-active']);
    expect(output.forbiddenTerms.map((item) => item.id)).toEqual(['term-enabled']);
  });
});
