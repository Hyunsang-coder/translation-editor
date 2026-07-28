import { useMemo } from 'react';
import { useReviewStore, type IssueSeverity, type ReviewIssue } from '@/stores/reviewStore';
import { useCommentStore, type UserComment } from '@/stores/commentStore';
import { normalizeForSearch, stripRichTextMarkup } from '@/utils/normalizeForSearch';
import type { AlignOp } from '@/utils/alignUnits';

export interface UnitAnnotations {
  issueCount: number;
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

function bump(
  map: Map<string, UnitAnnotations>,
  unitId: string,
  patch: (entry: UnitAnnotations) => void,
): void {
  const entry = map.get(unitId) ?? { issueCount: 0, topSeverity: null, commentCount: 0 };
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

/** 정렬 행에 붙일 이슈·코멘트 배지. 검수 결과나 코멘트가 바뀌면 다시 계산한다. */
export function useAlignmentAnnotations(ops: AlignOp[]): AlignmentAnnotations {
  const results = useReviewStore((s) => s.results);
  const comments = useCommentStore((s) => s.comments);

  return useMemo(
    () => computeAlignmentAnnotations(ops, results.flatMap((r) => r.issues), comments),
    [ops, results, comments]
  );
}
