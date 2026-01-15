import { useTranslation } from 'react-i18next';
import type { ReviewIssue, IssueType } from '@/stores/reviewStore';

interface ReviewResultsTableProps {
  issues: ReviewIssue[];
  onToggleCheck?: (issueId: string) => void;
  onToggleAll?: () => void;
  onDelete?: (issueId: string) => void;
  onApply?: (issue: ReviewIssue) => void;
  allChecked?: boolean;
}

function getIssueTypeLabel(type: IssueType): string {
  switch (type) {
    case 'error':
      return '오역';
    case 'omission':
      return '누락';
    case 'distortion':
      return '왜곡';
    case 'consistency':
      return '일관성';
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
    case 'consistency':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    default:
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
  }
}

/**
 * 마크다운 태그 제거
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1')       // *italic* → italic
    .replace(/`([^`]+)`/g, '$1')         // `code` → code
    .replace(/~~([^~]+)~~/g, '$1');      // ~~strikethrough~~ → strikethrough
}

export function ReviewResultsTable({
  issues,
  onToggleCheck,
  onToggleAll,
  onDelete,
  onApply,
  allChecked = false,
}: ReviewResultsTableProps): JSX.Element {
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
              {t('review.typeError', '오역')} {counts.error}
            </span>
          )}
          {counts.omission && (
            <span className="px-2 py-0.5 rounded text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400">
              {t('review.typeOmission', '누락')} {counts.omission}
            </span>
          )}
          {counts.distortion && (
            <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              {t('review.typeDistortion', '왜곡')} {counts.distortion}
            </span>
          )}
          {counts.consistency && (
            <span className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {t('review.typeConsistency', '일관성')} {counts.consistency}
            </span>
          )}
        </div>
      </div>

      {/* 테이블 - 컬럼 순서: 체크 | # | 유형 | 수정 제안 | 설명 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-editor-border">
              {/* 표시 (하이라이트) 헤더 */}
              <th className="px-2 py-2 text-center w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => onToggleAll?.()}
                  className="w-4 h-4 rounded border-editor-border text-primary-500 focus:ring-primary-500 cursor-pointer"
                  aria-label={t('review.selectAll', '전체 선택')}
                />
              </th>
              <th className="px-2 py-2 text-left font-medium text-editor-muted w-8">
                #
              </th>
              <th className="px-1 py-2 text-left font-medium text-editor-muted whitespace-nowrap">
                {t('review.issueType', '유형')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-editor-muted w-[45%]">
                {t('review.suggestedFix', '수정 제안')}
              </th>
              <th className="px-3 py-2 text-left font-medium text-editor-muted w-[45%]">
                {t('review.description', '설명')}
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, idx) => (
              <tr
                key={issue.id}
                className={`
                  border-b border-editor-border/50 hover:bg-editor-bg/50 transition-colors
                  ${issue.checked ? 'bg-primary-500/5' : ''}
                `}
              >
                {/* 표시 (하이라이트 토글) */}
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={issue.checked}
                    onChange={() => onToggleCheck?.(issue.id)}
                    className="w-4 h-4 rounded border-editor-border text-primary-500 focus:ring-primary-500 cursor-pointer"
                    aria-label={t('review.selectIssue', '이슈 선택')}
                  />
                </td>
                <td className="px-2 py-2 text-editor-muted font-medium text-center">
                  {idx + 1}
                </td>
                <td className="px-1 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${getIssueTypeColor(issue.type)}`}>
                    {getIssueTypeLabel(issue.type)}
                  </span>
                </td>
                <td className="px-3 py-2 text-editor-text text-xs">
                  <div className="flex flex-col gap-1.5">
                    <span className="break-words">
                      {issue.suggestedFix || '-'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {issue.suggestedFix && onApply && (
                        <button
                          type="button"
                          onClick={() => onApply(issue)}
                          className="px-1.5 py-0.5 text-xs rounded bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-500/20 transition-colors"
                          title={t('review.apply', '적용')}
                        >
                          {t('review.apply', '적용')}
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(issue.id)}
                          className="px-1.5 py-0.5 text-xs rounded bg-editor-surface text-editor-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                          title={t('review.ignore', '무시')}
                        >
                          {t('review.ignore', '무시')}
                        </button>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-editor-text text-xs">
                  {issue.description ? (
                    <ul className="list-disc list-inside space-y-0.5">
                      {stripMarkdown(issue.description).split(' | ').map((item, i) => (
                        <li key={i} className="break-words">{item}</li>
                      ))}
                    </ul>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
