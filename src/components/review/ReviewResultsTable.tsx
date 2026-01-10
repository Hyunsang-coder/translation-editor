import { useTranslation } from 'react-i18next';
import type { ReviewIssue, IssueType } from '@/stores/reviewStore';

interface ReviewResultsTableProps {
  issues: ReviewIssue[];
}

function getIssueTypeLabel(type: IssueType): string {
  switch (type) {
    case 'error':
      return '오역';
    case 'omission':
      return '누락';
    case 'distortion':
      return '왜곡';
    default:
      return type;
  }
}

function getIssueTypeColor(type: IssueType): string {
  switch (type) {
    case 'error':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'omission':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'distortion':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
    default:
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
  }
}

export function ReviewResultsTable({ issues }: ReviewResultsTableProps): JSX.Element {
  const { t } = useTranslation();

  if (issues.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 mb-3">
          <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-green-600 dark:text-green-400 font-medium">
          {t('review.noIssues', '오역이나 누락이 발견되지 않았습니다.')}
        </p>
      </div>
    );
  }

  // 이슈 타입별 카운트
  const counts = issues.reduce(
    (acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    },
    {} as Record<IssueType, number>,
  );

  return (
    <div className="space-y-4">
      {/* 통계 요약 */}
      <div className="flex items-center gap-4 text-sm">
        <span className="font-medium text-editor-text">
          {t('review.totalIssues', '총 {count}건', { count: issues.length })}
        </span>
        <div className="flex items-center gap-2">
          {counts.error && (
            <span className="px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-600 dark:text-red-400">
              오역 {counts.error}
            </span>
          )}
          {counts.omission && (
            <span className="px-2 py-0.5 rounded text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400">
              누락 {counts.omission}
            </span>
          )}
          {counts.distortion && (
            <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              왜곡 {counts.distortion}
            </span>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-editor-border">
              <th className="px-3 py-2 text-left font-medium text-editor-muted w-20">
                {t('review.segment', '세그먼트')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-editor-muted">
                {t('review.sourceExcerpt', '원문 구절')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-editor-muted w-24">
                {t('review.issueType', '유형')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-editor-muted">
                {t('review.description', '설명')}
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, idx) => (
              <tr
                key={`${issue.segmentOrder}-${idx}`}
                className="border-b border-editor-border/50 hover:bg-editor-bg/50 transition-colors"
              >
                <td className="px-3 py-2 text-editor-muted">
                  #{issue.segmentOrder}
                </td>
                <td className="px-3 py-2 text-editor-text max-w-[200px]">
                  <span className="line-clamp-2" title={issue.sourceExcerpt}>
                    {issue.sourceExcerpt}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${getIssueTypeColor(issue.type)}`}>
                    {getIssueTypeLabel(issue.type)}
                  </span>
                </td>
                <td className="px-3 py-2 text-editor-text">
                  {issue.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
