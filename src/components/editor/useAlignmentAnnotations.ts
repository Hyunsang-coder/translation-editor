import { useMemo } from 'react';
import { useReviewStore, type IssueSeverity, type ReviewIssue } from '@/stores/reviewStore';
import { useCommentStore, type UserComment } from '@/stores/commentStore';
import { sortReviewIssuesByDocumentOrder } from '@/components/review/reviewIssueOrder';
import { normalizeForSearch, stripRichTextMarkup } from '@/utils/normalizeForSearch';
import type { AlignOp } from '@/utils/alignUnits';

export interface UnitAnnotations {
  issueCount: number;
  /**
   * 이 유닛에 걸린 이슈 ID — 문서 순서. 배지에서 이슈 위치로 이동할 때
   * 첫 번째 항목을 대상으로 쓰므로 순서가 결정적이어야 한다.
   */
  issueIds: string[];
  /** 배지 색을 정할 최고 심각도 */
  topSeverity: IssueSeverity | null;
  commentCount: number;
}

export interface AlignmentAnnotations {
  byUnitId: Map<string, UnitAnnotations>;
  /** 어느 유닛으로도 특정하지 못한 이슈 수 — 이 값 자체가 정렬 품질 지표다 */
  unmappedIssueCount: number;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 3, major: 2, minor: 1 };

function normalize(text: string): string {
  return normalizeForSearch(stripRichTextMarkup(text));
}

/**
 * 구절이 어느 유닛에 속하는지 텍스트 포함 검사로 찾는다.
 *
 * `ReviewIssue.segmentGroupId`는 신뢰할 수 없다(`project.segments`가 죽은 모델).
 * 여러 유닛에 걸리면(중복 구절) **매핑하지 않는다** — 틀린 위치를 보여주느니
 * 안 보여주는 게 낫다.
 */
function findUnitId(excerpt: string, units: { id: string; text: string }[]): string | null {
  const needle = normalize(excerpt);
  if (!needle) return null;

  let found: string | null = null;
  for (const unit of units) {
    if (!unit.text.includes(needle)) continue;
    if (found) return null; // 중복 매치 — 포기
    found = unit.id;
  }
  return found;
}

function pickTopSeverity(a: IssueSeverity | null, b: IssueSeverity | null): IssueSeverity | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * 한 정렬 행의 배지 — 그 행에 걸린 유닛들의 주석을 합친다.
 *
 * 원문·번역문 유닛 ID는 **같을 수 있다**: 전체 번역·폴리싱을 적용하면
 * `reattachTranslationUnitIds`가 원문 ID를 번역문에 이식한다(정상 워크플로).
 * 중복 ID를 그대로 합치면 같은 항목을 두 번 세어 이슈 1건이 "이슈 2"로 보인다.
 */
export function mergeUnitAnnotations(
  byUnitId: Map<string, UnitAnnotations>,
  unitIds: Array<string | null | undefined>,
): UnitAnnotations | null {
  const uniqueIds = [...new Set(unitIds.filter((id): id is string => Boolean(id)))];
  const entries = uniqueIds
    .map((id) => byUnitId.get(id))
    .filter((entry): entry is UnitAnnotations => entry !== undefined);

  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]!;

  return entries.reduce((merged, entry) => ({
    issueCount: merged.issueCount + entry.issueCount,
    issueIds: [...merged.issueIds, ...entry.issueIds],
    commentCount: merged.commentCount + entry.commentCount,
    topSeverity: pickTopSeverity(merged.topSeverity, entry.topSeverity),
  }));
}

function bump(
  map: Map<string, UnitAnnotations>,
  unitId: string,
  patch: (entry: UnitAnnotations) => void,
): void {
  const entry = map.get(unitId)
    ?? { issueCount: 0, issueIds: [], topSeverity: null, commentCount: 0 };
  patch(entry);
  map.set(unitId, entry);
}

export function computeAlignmentAnnotations(
  ops: AlignOp[],
  issues: ReviewIssue[],
  comments: UserComment[],
): AlignmentAnnotations {
  const sourceUnits: { id: string; text: string }[] = [];
  const targetUnits: { id: string; text: string }[] = [];

  for (const op of ops) {
    if (op.kind !== 'target-only' && op.source.id) {
      sourceUnits.push({ id: op.source.id, text: normalize(op.source.text) });
    }
    if (op.kind !== 'source-only' && op.target.id) {
      targetUnits.push({ id: op.target.id, text: normalize(op.target.text) });
    }
  }

  const byUnitId = new Map<string, UnitAnnotations>();
  let unmappedIssueCount = 0;

  for (const issue of issues) {
    const unitId = findUnitId(issue.targetExcerpt, targetUnits);
    if (!unitId) {
      unmappedIssueCount += 1;
      continue;
    }
    bump(byUnitId, unitId, (entry) => {
      entry.issueCount += 1;
      entry.issueIds.push(issue.id);
      const rank = SEVERITY_RANK[issue.severity];
      const currentRank = entry.topSeverity ? SEVERITY_RANK[entry.topSeverity] : 0;
      if (rank > currentRank) entry.topSeverity = issue.severity;
    });
  }

  // 해결된 코멘트는 세지 않는다 — AI 주입에서도 빠지는 항목이라 배지로 남기면 오해를 준다
  for (const comment of comments) {
    if (comment.resolved) continue;
    const unitId = findUnitId(
      comment.excerpt,
      comment.field === 'source' ? sourceUnits : targetUnits,
    );
    if (!unitId) continue;
    bump(byUnitId, unitId, (entry) => { entry.commentCount += 1; });
  }

  return { byUnitId, unmappedIssueCount };
}

/**
 * 정렬 행에 붙일 이슈·코멘트 배지. 검수 결과나 코멘트가 바뀌면 다시 계산한다.
 *
 * 이슈 원천은 검수 패널 목록과 **같은** `getAllIssues()`다 — 해결·무시된 이슈가
 * 배지에만 남으면 눌렀을 때 존재하지 않는 카드로 이동하게 된다.
 * (`highlightNonce`는 결과·해결 상태가 바뀔 때마다 오르는 스토어의 재계산 신호다)
 */
export function useAlignmentAnnotations(ops: AlignOp[]): AlignmentAnnotations {
  const highlightNonce = useReviewStore((s) => s.highlightNonce);
  const getAllIssues = useReviewStore((s) => s.getAllIssues);
  const comments = useCommentStore((s) => s.comments);

  return useMemo(
    () => computeAlignmentAnnotations(
      ops,
      sortReviewIssuesByDocumentOrder(getAllIssues()),
      comments,
    ),
    // highlightNonce가 이슈 목록의 리비전이다 (getAllIssues는 참조가 고정된 액션)
    [ops, highlightNonce, getAllIssues, comments]
  );
}
