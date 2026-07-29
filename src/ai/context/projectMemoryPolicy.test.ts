import { describe, it, expect } from 'vitest';
import type { ProjectMemoryCategory, ProjectMemoryItem } from '@/types';
import { memoryItemLimit, selectMemoryItems } from './projectMemoryPolicy';

function item(
  id: string,
  category: ProjectMemoryCategory,
  source?: ProjectMemoryItem['source'],
): { id: string; category: ProjectMemoryCategory; source?: ProjectMemoryItem['source'] } {
  return { id, category, ...(source ? { source } : {}) };
}

describe('selectMemoryItems', () => {
  it('상한 이하면 입력을 그대로 돌려준다', () => {
    const items = [item('a', 'domain'), item('b', 'general')];
    const result = selectMemoryItems(items, 5);
    expect(result.selected).toEqual(items);
    expect(result.droppedCount).toBe(0);
  });

  it('상한을 넘으면 우선순위 높은 카테고리를 남긴다', () => {
    const items = [
      item('fact', 'reference_fact'),
      item('domain', 'domain'),
      item('intent', 'intent'),
      item('audience', 'audience'),
    ];
    const result = selectMemoryItems(items, 2);
    expect(result.selected.map((entry) => entry.id)).toEqual(['domain', 'audience']);
    expect(result.droppedCount).toBe(2);
  });

  it('선별 후에도 입력 순서를 유지한다', () => {
    const items = [
      item('audience', 'audience'),
      item('fact', 'reference_fact'),
      item('domain', 'domain'),
    ];
    const result = selectMemoryItems(items, 2);
    // 우선순위는 domain > audience지만 렌더링 순서는 원래 순서를 따른다.
    expect(result.selected.map((entry) => entry.id)).toEqual(['audience', 'domain']);
  });

  it('같은 우선순위면 최근 항목을 남긴다', () => {
    const items = [
      item('old', 'decision'),
      item('mid', 'decision'),
      item('new', 'decision'),
    ];
    const result = selectMemoryItems(items, 2);
    expect(result.selected.map((entry) => entry.id)).toEqual(['mid', 'new']);
    expect(result.droppedCount).toBe(1);
  });

  it('general은 배제되지 않는다 (legacy 마이그레이션·수동 추가의 기본 카테고리)', () => {
    const items = [
      item('fact', 'reference_fact'),
      item('legacy', 'general'),
    ];
    const result = selectMemoryItems(items, 1);
    expect(result.selected.map((entry) => entry.id)).toEqual(['legacy']);
  });

  it('직접 입력한 항목을 카테고리 우선순위보다 먼저 남긴다', () => {
    const items = [
      item('chat-domain', 'domain', 'chat'),
      item('user-general', 'general', 'user'),
    ];
    const result = selectMemoryItems(items, 1);
    expect(result.selected.map((entry) => entry.id)).toEqual(['user-general']);
  });

  it('source가 없으면 비-user로 취급한다 (필드 추가 이전 스냅샷)', () => {
    const items = [
      item('snapshot-domain', 'domain'),
      item('user-fact', 'reference_fact', 'user'),
    ];
    const result = selectMemoryItems(items, 1);
    expect(result.selected.map((entry) => entry.id)).toEqual(['user-fact']);
  });

  it('직접 입력끼리는 기존 카테고리 우선순위를 따른다', () => {
    const items = [
      item('general', 'general', 'user'),
      item('domain', 'domain', 'user'),
    ];
    const result = selectMemoryItems(items, 1);
    expect(result.selected.map((entry) => entry.id)).toEqual(['domain']);
  });

  it('상한이 0 이하면 전부 제외한다', () => {
    const result = selectMemoryItems([item('a', 'domain')], 0);
    expect(result.selected).toEqual([]);
    expect(result.droppedCount).toBe(1);
  });
});

describe('memoryItemLimit', () => {
  it('채팅 상한이 문서 워크플로우보다 작다', () => {
    expect(memoryItemLimit('general-chat')).toBeLessThan(memoryItemLimit('full-translate'));
  });
});
