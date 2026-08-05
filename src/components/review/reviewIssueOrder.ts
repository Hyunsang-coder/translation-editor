import type { AlignedSegment } from '@/ai/tools/reviewTool';
import {
  generateIssueId,
  type ReviewIssue,
} from '@/stores/reviewStore';

/**
 * Markdown 검수 응답에는 SegmentGroupId만 포함되므로, 검수에 사용한 세그먼트에서
 * 실제 문서 순번을 복원한다. 알 수 없는 ID는 레거시/외부 결과의 기존 순번을 보존한다.
 */
export function resolveReviewIssueSegmentOrders(
  issues: readonly ReviewIssue[],
  segments: readonly AlignedSegment[],
): ReviewIssue[] {
  const orderByGroupId = new Map(
    segments.map((segment) => [segment.groupId, segment.order] as const),
  );

  return issues.map((issue) => {
    const segmentOrder = issue.segmentGroupId
      ? orderByGroupId.get(issue.segmentGroupId)
      : undefined;

    if (segmentOrder === undefined || segmentOrder === issue.segmentOrder) {
      return issue;
    }

    return {
      ...issue,
      id: generateIssueId(
        segmentOrder,
        issue.type,
        issue.sourceExcerpt,
        issue.targetExcerpt,
      ),
      segmentOrder,
    };
  });
}

/** 문서 순번을 오름차순으로 정렬하되, 같은 세그먼트 안의 AI 응답 순서는 유지한다. */
export function sortReviewIssuesByDocumentOrder(
  issues: readonly ReviewIssue[],
): ReviewIssue[] {
  return issues
    .map((issue, originalIndex) => ({ issue, originalIndex }))
    .sort((a, b) =>
      a.issue.segmentOrder - b.issue.segmentOrder
      || a.originalIndex - b.originalIndex,
    )
    .map(({ issue }) => issue);
}
