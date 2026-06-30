import { describe, it, expect } from 'vitest';
import { serializeUserComments } from './commentContext';
import type { UserComment } from '@/stores/commentStore';

function makeComment(overrides: Partial<UserComment>): UserComment {
  return {
    id: 'cmt_1',
    field: 'source',
    segmentGroupId: undefined,
    excerpt: 'hello',
    comment: 'translate formally',
    resolved: false,
    createdAt: 0,
    ...overrides,
  };
}

describe('serializeUserComments', () => {
  it('returns empty string for empty array', () => {
    expect(serializeUserComments([])).toBe('');
  });

  it('returns empty string when all comments are resolved', () => {
    const comments = [
      makeComment({ id: 'a', resolved: true }),
      makeComment({ id: 'b', resolved: true }),
    ];
    expect(serializeUserComments(comments)).toBe('');
  });

  it('serializes two unresolved comments into a numbered block', () => {
    const comments = [
      makeComment({ id: 'a', excerpt: 'foo', comment: 'keep tone' }),
      makeComment({ id: 'b', excerpt: 'bar', comment: 'use term X' }),
    ];
    const result = serializeUserComments(comments);

    expect(result).toContain('[사용자 코멘트]');
    expect(result).toContain('1. "foo" — keep tone');
    expect(result).toContain('2. "bar" — use term X');
  });

  it('excludes resolved comments from the numbering', () => {
    const comments = [
      makeComment({ id: 'a', excerpt: 'foo', comment: 'keep tone', resolved: true }),
      makeComment({ id: 'b', excerpt: 'bar', comment: 'use term X', resolved: false }),
    ];
    const result = serializeUserComments(comments);

    expect(result).not.toContain('foo');
    expect(result).not.toContain('keep tone');
    expect(result).toContain('1. "bar" — use term X');
    expect(result).not.toContain('2.');
  });
});
