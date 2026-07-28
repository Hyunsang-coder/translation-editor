import { describe, it, expect } from 'vitest';
import type { ForbiddenTerm, ProjectMemoryItem, ProjectMemoryCategory } from '@/types';
import { renderChatMemoryDigest, renderSnapshotMemory } from './projectKnowledgeRender';

function memoryItem(
  overrides: Partial<ProjectMemoryItem> & Pick<ProjectMemoryItem, 'id' | 'content'>,
): ProjectMemoryItem {
  return {
    projectId: 'project-1',
    category: 'general' as ProjectMemoryCategory,
    normalizedHash: `hash-${overrides.id}`,
    status: 'active',
    source: 'chat',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function forbiddenTerm(
  overrides: Partial<ForbiddenTerm> & Pick<ForbiddenTerm, 'id' | 'term'>,
): ForbiddenTerm {
  return {
    projectId: 'project-1',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('renderChatMemoryDigest', () => {
  it('active 항목만 렌더링한다', () => {
    const digest = renderChatMemoryDigest({
      items: [
        memoryItem({ id: 'a', content: 'SF 세계관', category: 'worldbuilding' }),
        memoryItem({ id: 'b', content: '미승인 제안', status: 'proposed' }),
      ],
      forbiddenTerms: [],
    });
    expect(digest.projectMemory).toBe('- [worldbuilding] SF 세계관');
    expect(digest.itemIds).toEqual(['a']);
    expect(digest.truncated).toBe(false);
  });

  it('enabled 금칙어만 replacement/note와 함께 렌더링한다', () => {
    const digest = renderChatMemoryDigest({
      items: [],
      forbiddenTerms: [
        forbiddenTerm({ id: 't1', term: '유저', replacement: '플레이어' }),
        forbiddenTerm({ id: 't2', term: '꺼짐', note: '비속어' }),
        forbiddenTerm({ id: 't3', term: '비활성', enabled: false }),
      ],
    });
    expect(digest.forbiddenTerms).toBe('- 유저 → 플레이어\n- 꺼짐 (비속어)');
    expect(digest.forbiddenTermIds).toEqual(['t1', 't2']);
  });

  it('입력이 비면 빈 문자열을 돌려준다', () => {
    const digest = renderChatMemoryDigest({ items: [], forbiddenTerms: [] });
    expect(digest.projectMemory).toBe('');
    expect(digest.forbiddenTerms).toBe('');
    expect(digest.truncated).toBe(false);
  });

  it('maxItems를 넘으면 잘라내고 truncated를 표시한다', () => {
    const digest = renderChatMemoryDigest({
      items: [
        memoryItem({ id: 'a', content: 'A', category: 'domain' }),
        memoryItem({ id: 'b', content: 'B', category: 'reference_fact' }),
      ],
      forbiddenTerms: [],
      maxItems: 1,
    });
    expect(digest.itemIds).toEqual(['a']);
    expect(digest.truncated).toBe(true);
  });

  it('maxChars를 넘으면 줄 단위로 잘라낸다', () => {
    const digest = renderChatMemoryDigest({
      items: [
        memoryItem({ id: 'a', content: 'x'.repeat(40), category: 'domain' }),
        memoryItem({ id: 'b', content: 'y'.repeat(40), category: 'audience' }),
      ],
      forbiddenTerms: [],
      maxChars: 60,
    });
    expect(digest.itemIds).toEqual(['a']);
    expect(digest.projectMemory).not.toContain('y');
    expect(digest.truncated).toBe(true);
  });

  it('금칙어 개수 상한을 넘으면 truncated를 표시한다', () => {
    const digest = renderChatMemoryDigest({
      items: [],
      forbiddenTerms: [
        forbiddenTerm({ id: 't1', term: 'A' }),
        forbiddenTerm({ id: 't2', term: 'B' }),
      ],
      maxForbiddenTerms: 1,
    });
    expect(digest.forbiddenTermIds).toEqual(['t1']);
    expect(digest.truncated).toBe(true);
  });

  it('itemIds는 실제 렌더링된 항목만 담는다', () => {
    const digest = renderChatMemoryDigest({
      items: [
        memoryItem({ id: 'a', content: 'A', category: 'domain' }),
        memoryItem({ id: 'b', content: 'B', status: 'proposed' }),
        memoryItem({ id: 'c', content: 'C', category: 'reference_fact' }),
      ],
      forbiddenTerms: [],
      maxItems: 1,
    });
    expect(digest.projectMemory.split('\n')).toHaveLength(digest.itemIds.length);
  });
});

describe('renderSnapshotMemory', () => {
  it('상한을 적용하고 주입된 ID만 돌려준다', () => {
    const result = renderSnapshotMemory(
      [
        { id: 'a', category: 'reference_fact', content: 'A' },
        { id: 'b', category: 'domain', content: 'B' },
      ],
      1,
    );
    expect(result.text).toBe('- [domain] B');
    expect(result.itemIds).toEqual(['b']);
    expect(result.droppedCount).toBe(1);
  });
});
