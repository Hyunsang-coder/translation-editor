import { describe, expect, it } from 'vitest';
import { isToolAuditArtifact } from './toolAudit';

describe('isToolAuditArtifact', () => {
  it('세 id 배열을 모두 담은 객체를 받아들인다', () => {
    expect(isToolAuditArtifact({
      projectMemoryItemIds: ['m1'],
      forbiddenTermIds: ['t1', 't2'],
      glossaryEntryIds: [],
    })).toBe(true);
  });

  it('일부 필드만 있어도, 빈 객체여도 받아들인다', () => {
    expect(isToolAuditArtifact({ glossaryEntryIds: ['g1'] })).toBe(true);
    expect(isToolAuditArtifact({})).toBe(true);
  });

  it('알 수 없는 필드는 무시하고 받아들인다', () => {
    expect(isToolAuditArtifact({ glossaryEntryIds: ['g1'], extra: 1 })).toBe(true);
  });

  it('객체가 아니면 거부한다', () => {
    expect(isToolAuditArtifact(undefined)).toBe(false);
    expect(isToolAuditArtifact(null)).toBe(false);
    expect(isToolAuditArtifact('glossaryEntryIds')).toBe(false);
    expect(isToolAuditArtifact(42)).toBe(false);
    expect(isToolAuditArtifact(['g1'])).toBe(false);
  });

  it('id 필드가 문자열 배열이 아니면 거부한다', () => {
    expect(isToolAuditArtifact({ glossaryEntryIds: 'g1' })).toBe(false);
    expect(isToolAuditArtifact({ glossaryEntryIds: [1, 2] })).toBe(false);
    expect(isToolAuditArtifact({ forbiddenTermIds: ['t1', null] })).toBe(false);
    expect(isToolAuditArtifact({ projectMemoryItemIds: { 0: 'm1' } })).toBe(false);
  });

  it('한 필드라도 잘못되면 다른 필드가 정상이어도 거부한다', () => {
    expect(isToolAuditArtifact({
      projectMemoryItemIds: ['m1'],
      glossaryEntryIds: [1],
    })).toBe(false);
  });
});
