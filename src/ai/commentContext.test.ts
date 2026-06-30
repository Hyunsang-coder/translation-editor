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

  it('filters by field when options.field is given (polishing → target only)', () => {
    const comments = [
      makeComment({ id: 'a', field: 'source', excerpt: 'src', comment: 'source note' }),
      makeComment({ id: 'b', field: 'target', excerpt: 'tgt', comment: 'target note' }),
    ];
    const result = serializeUserComments(comments, { field: 'target' });

    expect(result).toContain('1. "tgt" — target note');
    expect(result).not.toContain('src');
    expect(result).not.toContain('source note');
  });

  it('returns empty string when no comment matches the field filter', () => {
    const comments = [makeComment({ id: 'a', field: 'source' })];
    expect(serializeUserComments(comments, { field: 'target' })).toBe('');
  });

  it('uses a custom leadIn when provided', () => {
    const comments = [makeComment({ id: 'a', excerpt: 'foo', comment: 'bar' })];
    const result = serializeUserComments(comments, { leadIn: 'POLISH LEAD-IN:' });

    expect(result).toContain('[사용자 코멘트]');
    expect(result).toContain('POLISH LEAD-IN:');
    expect(result).not.toContain('번역 시 반드시');
  });
});
