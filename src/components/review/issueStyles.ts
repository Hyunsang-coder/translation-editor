/**
 * 검수 이슈 배지 스타일 — 색 정의는 이 파일 한 곳에서만 한다.
 * (ReviewResultsTable과 dev/ReviewTestPanel이 함께 쓴다)
 *
 * 규칙: 이슈 "유형"은 무채색 칩으로 글자만 구분하고,
 * "심각도"만 의미색을 쓴다 (critical/major/minor=primary 3단).
 */
import type { IssueType, IssueSeverity } from '@/stores/reviewStore';

/** 이슈 유형 칩 — 유형별 색 매핑 금지. 전부 같은 무채색 칩이다. */
export const ISSUE_TYPE_CHIP = 'bg-editor-surface text-editor-muted';

export function getIssueTypeColor(_type: IssueType): string {
  return ISSUE_TYPE_CHIP;
}

export function getSeverityColor(severity: IssueSeverity): string {
  switch (severity) {
    case 'critical':
      return 'text-severity-critical';
    case 'major':
      return 'text-severity-major';
    case 'minor':
      return 'text-primary-500';
    default:
      return 'text-editor-muted';
  }
}

/** 심각도 요약 필터 칩 (활성 상태) */
export function getSeverityChipColor(severity: IssueSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-severity-critical/10 text-severity-critical';
    case 'major':
      return 'bg-severity-major/10 text-severity-major';
    case 'minor':
      return 'bg-primary-500/10 text-primary-500';
    default:
      return 'bg-editor-surface text-editor-muted';
  }
}
