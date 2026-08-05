import { describe, expect, it } from 'vitest';
import type { AlignedSegment } from '@/ai/tools/reviewTool';
import type { ReviewIssue } from '@/stores/reviewStore';
import { resolveReviewIssueSegmentOrders } from './reviewIssueOrder';

function makeIssue(overrides: Partial<ReviewIssue>): ReviewIssue {
  return {
    id: 'issue',
    segmentOrder: 0,
    segmentGroupId: undefined,
    sourceExcerpt: 'source',
    targetExcerpt: 'target',
    suggestedFix: 'fix',
    type: 'mistranslation',
    severity: 'major',
    description: 'description',
    checked: true,
    ...overrides,
  };
}

const segments: AlignedSegment[] = [
  { groupId: 'segment-first', order: 10, sourceText: 'first source', targetText: 'first target' },
  { groupId: 'segment-last', order: 30, sourceText: 'last source', targetText: 'last target' },
];

describe('resolveReviewIssueSegmentOrders', () => {
  it('AI 응답의 SegmentGroupId를 실제 문서 세그먼트 순서로 변환한다', () => {
    const resolved = resolveReviewIssueSegmentOrders([
      makeIssue({ id: 'parsed-last', segmentGroupId: 'segment-last' }),
      makeIssue({ id: 'parsed-first', segmentGroupId: 'segment-first' }),
    ], segments);

    expect(resolved.map((issue) => issue.segmentOrder)).toEqual([30, 10]);
    expect(resolved[0]?.id).not.toBe('parsed-last');
    expect(resolved[1]?.id).not.toBe('parsed-first');
  });

  it('알 수 없는 SegmentGroupId는 파서가 제공한 순서를 보존한다', () => {
    const issue = makeIssue({ id: 'legacy', segmentOrder: 7, segmentGroupId: 'unknown' });

    expect(resolveReviewIssueSegmentOrders([issue], segments)).toEqual([issue]);
  });
});
