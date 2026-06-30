import { describe, it, expect, beforeEach } from 'vitest';
import { useCommentStore, generateCommentId } from './commentStore';

const reset = () => useCommentStore.getState().clear();

describe('commentStore', () => {
  beforeEach(reset);

  it('addComment creates a deterministic-id comment and returns it', () => {
    const c = useCommentStore.getState().addComment({
      field: 'source',
      excerpt: 'hello',
      comment: '인사말 확인',
      createdAt: 1000,
    });
    expect(c.id).toBe(generateCommentId('source', 'hello', 1000));
    expect(c.resolved).toBe(false);
    expect(useCommentStore.getState().comments).toHaveLength(1);
  });

  it('updateComment patches body', () => {
    const c = useCommentStore.getState().addComment({
      field: 'target', excerpt: 'x', comment: 'a', createdAt: 1,
    });
    useCommentStore.getState().updateComment(c.id, { comment: 'b' });
    expect(useCommentStore.getState().getComment(c.id)?.comment).toBe('b');
  });

  it('resolveComment toggles resolved', () => {
    const c = useCommentStore.getState().addComment({
      field: 'target', excerpt: 'x', comment: 'a', createdAt: 2,
    });
    useCommentStore.getState().resolveComment(c.id, true);
    expect(useCommentStore.getState().getComment(c.id)?.resolved).toBe(true);
  });

  it('removeComment deletes', () => {
    const c = useCommentStore.getState().addComment({
      field: 'source', excerpt: 'x', comment: 'a', createdAt: 3,
    });
    useCommentStore.getState().removeComment(c.id);
    expect(useCommentStore.getState().comments).toHaveLength(0);
  });

  it('getCommentsForField filters by field', () => {
    const s = useCommentStore.getState();
    s.addComment({ field: 'source', excerpt: 's', comment: 'a', createdAt: 4 });
    s.addComment({ field: 'target', excerpt: 't', comment: 'b', createdAt: 5 });
    expect(useCommentStore.getState().getCommentsForField('source')).toHaveLength(1);
    expect(useCommentStore.getState().getCommentsForField('target')).toHaveLength(1);
  });

  it('pruneOrphans removes comments whose id is not live', () => {
    const s = useCommentStore.getState();
    const keep = s.addComment({ field: 'source', excerpt: 'k', comment: 'a', createdAt: 6 });
    s.addComment({ field: 'source', excerpt: 'orphan', comment: 'b', createdAt: 7 });
    useCommentStore.getState().pruneOrphans(new Set([keep.id]));
    const remaining = useCommentStore.getState().comments;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(keep.id);
  });

  it('setComments replaces all', () => {
    const s = useCommentStore.getState();
    s.addComment({ field: 'source', excerpt: 'x', comment: 'a', createdAt: 8 });
    s.setComments([]);
    expect(useCommentStore.getState().comments).toHaveLength(0);
  });
});
