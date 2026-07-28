import { describe, expect, it } from 'vitest';
import {
  buildContextSnapshot,
  resolveWorkflowContextFromSnapshot,
} from './resolveWorkflowContext';

const memoryItems = [
  {
    id: 'active-1',
    projectId: 'project-1',
    category: 'audience' as const,
    content: 'IT 관리자 대상',
    normalizedHash: 'a',
    status: 'active' as const,
    source: 'user' as const,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'proposed-1',
    projectId: 'project-1',
    category: 'general' as const,
    content: '아직 승인되지 않은 제안',
    normalizedHash: 'b',
    status: 'proposed' as const,
    source: 'user' as const,
    createdAt: 1,
    updatedAt: 1,
  },
];

describe('workflow context snapshot', () => {
  it('active memory와 enabled 금칙어만 복사해 이후 원본 변경과 분리한다', () => {
    const snapshot = buildContextSnapshot({
      revision: 7,
      projectMemoryItems: memoryItems,
      translationRules: '합니다체',
      forbiddenTerms: [
        {
          id: 'term-1',
          projectId: 'project-1',
          term: '금칙',
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'term-2',
          projectId: 'project-1',
          term: '비활성',
          enabled: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      glossaryEntries: [{ id: 'g1', source: 'Cloud', target: '클라우드' }],
      createdAt: 100,
    });

    memoryItems[0]!.content = '나중에 변경됨';
    expect(snapshot.projectMemoryItems).toEqual([
      { id: 'active-1', category: 'audience', content: 'IT 관리자 대상' },
    ]);
    expect(snapshot.forbiddenTerms.map((term) => term.id)).toEqual(['term-1']);
  });

  it('구조화 메모리가 비어 있으면 legacy Project Context를 보존한다', () => {
    const snapshot = buildContextSnapshot({
      revision: 2,
      projectMemoryItems: [],
      legacyProjectContext: 'Enterprise release notes for administrators.',
      translationRules: '',
      forbiddenTerms: [],
      glossaryEntries: [],
      createdAt: 10,
    });

    expect(snapshot.projectMemoryItems).toEqual([{
      id: 'legacy-project-context',
      category: 'general',
      content: 'Enterprise release notes for administrators.',
    }]);
  });

  it('selection retranslate는 체크된 컨텍스트만 렌더링한다', () => {
    const snapshot = buildContextSnapshot({
      revision: 2,
      projectMemoryItems: memoryItems,
      translationRules: '합니다체',
      forbiddenTerms: [],
      glossaryEntries: [{ id: 'g1', source: 'Cloud', target: '클라우드' }],
      createdAt: 100,
    });
    const resolved = resolveWorkflowContextFromSnapshot({
      mode: 'selection-retranslate',
      snapshot,
      referenceOptions: {
        translationRules: false,
        forbiddenTerms: false,
        glossary: true,
        projectContext: false,
      },
    });

    expect(resolved.rendered.glossary).toContain('Cloud = 클라우드');
    expect(resolved.rendered.translationRules).toBeUndefined();
    expect(resolved.rendered.projectMemory).toBeUndefined();
    expect(resolved.manifest.glossaryEntryIds).toEqual(['g1']);
  });

  it('메모리가 상한을 넘으면 우선순위대로 잘라내고 manifest가 실제 주입분과 일치한다 (D6)', () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      id: `fact-${index}`,
      projectId: 'project-1',
      category: 'reference_fact' as const,
      content: `참고 사실 ${index}`,
      normalizedHash: `h${index}`,
      status: 'active' as const,
      source: 'user' as const,
      createdAt: index,
      updatedAt: index,
    }));
    const snapshot = buildContextSnapshot({
      revision: 3,
      projectMemoryItems: [
        {
          id: 'domain-1',
          projectId: 'project-1',
          category: 'domain',
          content: '항공 정비 매뉴얼',
          normalizedHash: 'd1',
          status: 'active',
          source: 'user',
          createdAt: 999,
          updatedAt: 999,
        },
        ...many,
      ],
      translationRules: '',
      forbiddenTerms: [],
      glossaryEntries: [],
      createdAt: 100,
    });
    const resolved = resolveWorkflowContextFromSnapshot({ mode: 'full-translate', snapshot });

    // snapshot은 전체를 유지하고, 주입만 상한을 적용한다
    expect(snapshot.projectMemoryItems).toHaveLength(46);
    expect(resolved.manifest.projectMemoryItemIds).toHaveLength(40);
    // 우선순위가 높은 domain은 뒤늦게 추가됐어도 살아남는다
    expect(resolved.manifest.projectMemoryItemIds).toContain('domain-1');
    expect(resolved.rendered.projectMemory?.split('\n')).toHaveLength(40);
  });

  it('상한 이하면 모든 active 항목을 주입한다 (D6)', () => {
    const snapshot = buildContextSnapshot({
      revision: 1,
      projectMemoryItems: memoryItems,
      translationRules: '',
      forbiddenTerms: [],
      glossaryEntries: [],
      createdAt: 100,
    });
    const resolved = resolveWorkflowContextFromSnapshot({ mode: 'full-translate', snapshot });

    expect(resolved.manifest.projectMemoryItemIds).toEqual(['active-1']);
    expect(resolved.rendered.projectMemory).toContain('[audience]');
  });

  it('review snapshot 객체를 모든 chunk에서 그대로 재사용할 수 있다', () => {
    const snapshot = buildContextSnapshot({
      revision: 9,
      projectMemoryItems: memoryItems,
      translationRules: '규칙',
      forbiddenTerms: [],
      glossaryEntries: [],
      createdAt: 100,
    });
    const first = resolveWorkflowContextFromSnapshot({ mode: 'review', snapshot });
    const second = resolveWorkflowContextFromSnapshot({ mode: 'review', snapshot });

    expect(first.snapshot).toBe(snapshot);
    expect(second.snapshot).toBe(snapshot);
    expect(first.manifest).toEqual(second.manifest);
  });
});
