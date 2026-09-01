import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  computeAlignmentAnnotations,
  mergeUnitAnnotations,
  useAlignmentAnnotations,
  type UnitAnnotations,
} from '@/components/editor/useAlignmentAnnotations';
import { useReviewStore } from '@/stores/reviewStore';
import { useCommentStore } from '@/stores/commentStore';
import type { AlignOp } from '@/utils/alignUnits';
import type { ReviewIssue } from '@/stores/reviewStore';
import type { UserComment } from '@/stores/commentStore';

function pair(sourceId: string, sourceText: string, targetId: string, targetText: string): AlignOp {
  return {
    kind: 'pair',
    source: { id: sourceId, type: 'paragraph', path: [0], text: sourceText },
    target: { id: targetId, type: 'paragraph', path: [0], text: targetText },
  };
}

function issue(targetExcerpt: string, severity: ReviewIssue['severity'] = 'major'): ReviewIssue {
  return {
    id: `issue-${targetExcerpt}-${severity}`,
    segmentOrder: 0,
    segmentGroupId: undefined,
    sourceExcerpt: '',
    targetExcerpt,
    suggestedFix: '',
    type: 'mistranslation',
    severity,
    description: '',
    checked: false,
  };
}

function comment(field: UserComment['field'], excerpt: string, resolved = false): UserComment {
  return {
    id: `cmt-${field}-${excerpt}`,
    field,
    excerpt,
    comment: '메모',
    resolved,
    createdAt: 0,
  };
}

const ops: AlignOp[] = [
  pair('s1', 'The recoil was reduced.', 't1', '반동이 감소했습니다.'),
  pair('s2', 'Throwables changed.', 't2', '투척류가 변경되었습니다.'),
];

describe('computeAlignmentAnnotations', () => {
  it('구절이 들어 있는 유닛에 이슈를 매핑한다', () => {
    const result = computeAlignmentAnnotations(ops, [issue('반동이 감소')], []);

    expect(result.byUnitId.get('t1')?.issueCount).toBe(1);
    expect(result.unmappedIssueCount).toBe(0);
  });

  it('가장 높은 심각도로 배지 색을 정한다', () => {
    const result = computeAlignmentAnnotations(
      ops,
      [issue('반동이', 'minor'), issue('감소했습니다', 'critical')],
      []
    );

    expect(result.byUnitId.get('t1')).toMatchObject({ issueCount: 2, topSeverity: 'critical' });
  });

  it('어느 유닛에도 없는 구절은 매핑하지 않고 따로 센다', () => {
    const result = computeAlignmentAnnotations(ops, [issue('존재하지 않는 구절')], []);

    expect(result.byUnitId.size).toBe(0);
    expect(result.unmappedIssueCount).toBe(1);
  });

  it('여러 유닛에 걸리는 구절은 매핑하지 않는다 — 틀린 위치보다 안 보여주는 게 낫다', () => {
    const duplicated: AlignOp[] = [
      pair('s1', 'a', 't1', '같은 문장입니다.'),
      pair('s2', 'b', 't2', '같은 문장입니다.'),
    ];

    const result = computeAlignmentAnnotations(duplicated, [issue('같은 문장')], []);

    expect(result.byUnitId.size).toBe(0);
    expect(result.unmappedIssueCount).toBe(1);
  });

  it('코멘트는 자기 필드 쪽 유닛에서 찾고, 해결된 것은 세지 않는다', () => {
    const result = computeAlignmentAnnotations(
      ops,
      [],
      [
        comment('source', 'recoil was reduced'),
        comment('target', '투척류가'),
        comment('target', '반동이', true),
      ]
    );

    expect(result.byUnitId.get('s1')?.commentCount).toBe(1);
    expect(result.byUnitId.get('t2')?.commentCount).toBe(1);
    expect(result.byUnitId.get('t1')).toBeUndefined();
  });
});

describe('useAlignmentAnnotations 이슈 원천', () => {
  function seedReview(issues: ReviewIssue[], resolvedIssueIds: string[] = []): void {
    useReviewStore.setState({
      results: [{ chunkIndex: 0, issues }],
      resolvedIssueIds,
      reviewActionHistory: [],
      highlightNonce: useReviewStore.getState().highlightNonce + 1,
    });
    useCommentStore.setState({ comments: [] });
  }

  it('행별 issueIds가 issueCount와 일치하고 문서 순서를 따른다', () => {
    const first = { ...issue('반동이 감소'), id: 'later', segmentOrder: 5 };
    const second = { ...issue('반동이'), id: 'earlier', segmentOrder: 1 };
    seedReview([first, second]);

    const { result } = renderHook(() => useAlignmentAnnotations(ops));

    const entry = result.current.byUnitId.get('t1')!;
    expect(entry.issueCount).toBe(2);
    expect(entry.issueIds).toEqual(['earlier', 'later']);
  });

  it('해결된 이슈는 개수와 issueIds에서 함께 빠진다', () => {
    const kept = { ...issue('반동이 감소'), id: 'kept' };
    const resolved = { ...issue('반동이'), id: 'resolved-one' };
    seedReview([kept, resolved], ['resolved-one']);

    const { result } = renderHook(() => useAlignmentAnnotations(ops));

    expect(result.current.byUnitId.get('t1')).toMatchObject({
      issueCount: 1,
      issueIds: ['kept'],
    });
  });
});

describe('mergeUnitAnnotations', () => {
  function entry(overrides: Partial<UnitAnnotations> = {}): UnitAnnotations {
    return { issueCount: 1, issueIds: ['i1'], topSeverity: 'major', commentCount: 1, ...overrides };
  }

  it('원문·번역문이 같은 유닛 ID를 쓰는 문서에서 두 번 세지 않는다', () => {
    // 전체 번역/폴리싱을 적용하면 reattachTranslationUnitIds가 원문 ID를 번역문에 이식한다
    const byUnitId = new Map([['same', entry()]]);

    expect(mergeUnitAnnotations(byUnitId, ['same', 'same'])).toEqual(entry());
  });

  it('서로 다른 유닛의 주석은 합치고 최고 심각도를 고른다', () => {
    const byUnitId = new Map([
      ['s1', entry({ issueCount: 0, issueIds: [], topSeverity: null, commentCount: 2 })],
      ['t1', entry({ issueIds: ['i9'], topSeverity: 'critical' })],
    ]);

    expect(mergeUnitAnnotations(byUnitId, ['s1', 't1'])).toEqual({
      issueCount: 1,
      issueIds: ['i9'],
      commentCount: 3,
      topSeverity: 'critical',
    });
  });

  it('매핑된 유닛이 없으면 배지를 만들지 않는다', () => {
    expect(mergeUnitAnnotations(new Map(), ['s1', null])).toBeNull();
  });
});
