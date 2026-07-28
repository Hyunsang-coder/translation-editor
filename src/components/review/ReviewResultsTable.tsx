import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewIssue, IssueType, IssueSeverity } from '@/stores/reviewStore';
import { stripRichTextMarkup } from '@/utils/normalizeForSearch';

interface ReviewResultsTableProps {
  issues: ReviewIssue[];
  onToggleCheck?: (issueId: string) => void;
  onToggleAll?: () => void;
  onDelete?: (issueId: string) => void;
  onCopy?: (issue: ReviewIssue) => void;
  onApply?: (issue: ReviewIssue) => void;
  /** 이슈가 가리키는 번역문 구절을 에디터에서 선택·포커스한다 */
  onViewInDocument?: (issue: ReviewIssue) => void;
  allChecked?: boolean;
  totalIssuesFound?: number;  // 검수 완료 시점의 총 이슈 수
  severityFilter?: IssueSeverity[];
  onToggleSeverity?: (severity: IssueSeverity) => void;
}

const issueTypeLabelKeys: Record<IssueType, string> = {
  omission: 'review.typeOmission',
  addition: 'review.typeAddition',
  mistranslation: 'review.typeMistranslation',
  grammar: 'review.typeGrammar',
  awkward: 'review.typeAwkward',
  terminology: 'review.typeTerminology',
};

function getIssueTypeColor(type: IssueType): string {
  switch (type) {
    case 'mistranslation':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'omission':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'addition':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'grammar':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
    case 'awkward':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'terminology':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    default:
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
  }
}

const severityLabelKeys: Record<IssueSeverity, string> = {
  critical: 'review.severityCritical',
  major: 'review.severityMajor',
  minor: 'review.severityMinor',
};

function getSeverityColor(severity: IssueSeverity): string {
  switch (severity) {
    case 'critical':
      return 'text-red-600 dark:text-red-400';
    case 'major':
      return 'text-orange-600 dark:text-orange-400';
    case 'minor':
      return 'text-blue-500 dark:text-blue-400';
    default:
      return 'text-gray-500';
  }
}

export function ReviewResultsTable({
  issues,
  onToggleCheck,
  onToggleAll,
  onDelete,
  onCopy,
  onApply,
  onViewInDocument,
  allChecked = false,
  totalIssuesFound = 0,
  severityFilter,
  onToggleSeverity,
}: ReviewResultsTableProps): JSX.Element {
  const { t } = useTranslation();

  // 전체 이슈에서 심각도별 카운트 (필터링 전)
  const severityCounts = useMemo(
    () =>
      issues.reduce(
        (acc, issue) => {
          acc[issue.severity] = (acc[issue.severity] || 0) + 1;
          return acc;
        },
        {} as Record<IssueSeverity, number>,
      ),
    [issues],
  );

  // severity 필터 적용
  const filteredIssues = useMemo(
    () => severityFilter ? issues.filter((issue) => severityFilter.includes(issue.severity)) : issues,
    [issues, severityFilter],
  );

  // 필터링된 이슈 타입별 카운트
  const counts = useMemo(
    () =>
      filteredIssues.reduce(
        (acc, issue) => {
          acc[issue.type] = (acc[issue.type] || 0) + 1;
          return acc;
        },
        {} as Record<IssueType, number>,
      ),
    [filteredIssues],
  );

  if (issues.length === 0) {
    // 원래 이슈가 있었지만 모두 해결된 경우 vs 처음부터 이슈가 없던 경우 구분
    const message = totalIssuesFound > 0
      ? t('review.allResolved', '모든 이슈가 해결되었습니다.')
      : t('review.noIssues', '오역이나 누락이 발견되지 않았습니다.');

    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 mb-3">
          <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-green-600 dark:text-green-400 font-medium">
          {message}
        </p>
      </div>
    );
  }

  const isFiltered = severityFilter && filteredIssues.length !== issues.length;

  return (
    <div className="space-y-4 h-full flex flex-col min-h-0">
      {/* 통계 요약 */}
      <div className="flex flex-col gap-2 text-xs shrink-0">
        {/* 심각도 요약 (클릭 가능한 필터 토글) */}
        <div className="flex items-center gap-3">
          <span className="font-medium text-editor-text">
            {isFiltered
              ? t('review.filteredCount', '총 {{total}}건 중 {{count}}건 표시', { total: issues.length, count: filteredIssues.length })
              : t('review.totalIssues', '총 {{count}}건', { count: issues.length })}
          </span>
          <div className="flex items-center gap-1.5">
            {severityCounts.critical ? (
              <button
                type="button"
                onClick={() => onToggleSeverity?.('critical')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  !severityFilter || severityFilter.includes('critical')
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-gray-500/5 text-gray-400 dark:text-gray-600'
                }`}
              >
                {t(severityLabelKeys.critical)} {severityCounts.critical}
              </button>
            ) : null}
            {severityCounts.major ? (
              <button
                type="button"
                onClick={() => onToggleSeverity?.('major')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  !severityFilter || severityFilter.includes('major')
                    ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                    : 'bg-gray-500/5 text-gray-400 dark:text-gray-600'
                }`}
              >
                {t(severityLabelKeys.major)} {severityCounts.major}
              </button>
            ) : null}
            {severityCounts.minor ? (
              <button
                type="button"
                onClick={() => onToggleSeverity?.('minor')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  !severityFilter || severityFilter.includes('minor')
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-gray-500/5 text-gray-400 dark:text-gray-600'
                }`}
              >
                {t(severityLabelKeys.minor)} {severityCounts.minor}
              </button>
            ) : null}
          </div>
        </div>
        {/* 유형별 요약 */}
        <div className="flex items-center gap-2 flex-wrap">
          {counts.mistranslation && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-600 dark:text-red-400">
              {t('review.typeMistranslation', '오역')} {counts.mistranslation}
            </span>
          )}
          {counts.omission && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-600 dark:text-orange-400">
              {t('review.typeOmission', '누락')} {counts.omission}
            </span>
          )}
          {counts.addition && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400">
              {t('review.typeAddition', '추가')} {counts.addition}
            </span>
          )}
          {counts.grammar && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              {t('review.typeGrammar', '문법')} {counts.grammar}
            </span>
          )}
          {counts.awkward && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
              {t('review.typeAwkward', '직역투')} {counts.awkward}
            </span>
          )}
          {counts.terminology && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {t('review.typeTerminology', '용어')} {counts.terminology}
            </span>
          )}
        </div>
      </div>

      {/* 이슈 카드 리스트 — 250px 사이드바에서 3열 table-fixed가 뭉개지던 것을 대체 */}
      <div className="flex-1 overflow-y-auto border border-editor-border rounded-md min-h-0">
        <label className="sticky top-0 z-10 flex items-center gap-2 px-3.5 py-2 bg-editor-surface border-b border-editor-border text-[11px] text-editor-muted cursor-pointer">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={() => onToggleAll?.()}
            className="w-3.5 h-3.5 rounded border-editor-border text-primary-500 focus:ring-primary-500 cursor-pointer"
            aria-label={t('review.selectAll', '전체 선택')}
          />
          <span>{t('review.selectAll', '전체 선택')}</span>
        </label>

        {filteredIssues.map((issue, idx) => (
          <div
            key={issue.id}
            data-testid="review-issue-card"
            className={`
              p-3.5 border-b border-editor-border border-l-[3px] transition-colors
              ${issue.checked
                ? 'bg-accent-tint border-l-primary-500'
                : 'border-l-transparent hover:bg-editor-bg/50'}
            `}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={issue.checked}
                onChange={() => onToggleCheck?.(issue.id)}
                className="w-3.5 h-3.5 shrink-0 rounded border-editor-border text-primary-500 focus:ring-primary-500 cursor-pointer"
                aria-label={t('review.selectIssue', '이슈 선택')}
              />
              <span className={`text-[10px] font-bold ${getSeverityColor(issue.severity)}`}>
                {t(severityLabelKeys[issue.severity])}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${getIssueTypeColor(issue.type)}`}>
                {t(issueTypeLabelKeys[issue.type])}
              </span>
              <span className="ml-auto text-[11px] text-editor-muted tabular-nums">{idx + 1}</span>
            </div>

            {issue.targetExcerpt && (
              <p className="mt-2 text-xs text-editor-muted line-through break-words">
                {stripRichTextMarkup(issue.targetExcerpt)}
              </p>
            )}
            {issue.suggestedFix && (
              <p className="mt-1 text-xs font-bold text-accent-deep break-words">
                {stripRichTextMarkup(issue.suggestedFix)}
              </p>
            )}
            {issue.description && (
              <div className="mt-1.5 space-y-0.5 text-xs text-editor-muted">
                {stripRichTextMarkup(issue.description).split(' | ').map((item, i) => (
                  <div key={`${issue.id}-desc-${i}`} className="break-words">{item}</div>
                ))}
              </div>
            )}

            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              {/* 적용 가능 조건: 교체 앵커(targetExcerpt)와 제안이 모두 있을 때.
                  완전 누락((missing) → targetExcerpt 없음)은 삽입 위치를 특정할 수 없어 복사만 제공 */}
              {issue.suggestedFix && issue.targetExcerpt && onApply && (
                <button
                  type="button"
                  onClick={() => onApply(issue)}
                  className="h-7 px-2 text-xs rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                  title={t('review.apply', '적용')}
                >
                  {t('review.apply', '적용')}
                </button>
              )}
              {issue.targetExcerpt && onViewInDocument && (
                <button
                  type="button"
                  onClick={() => onViewInDocument(issue)}
                  className="h-7 px-2 text-xs rounded bg-editor-surface text-editor-text hover:bg-editor-border transition-colors"
                  title={t('review.viewInDocument', '본문에서 보기')}
                >
                  {t('review.viewInDocument', '본문에서 보기')}
                </button>
              )}
              {issue.suggestedFix && onCopy && (
                <button
                  type="button"
                  onClick={() => onCopy(issue)}
                  className="h-7 px-2 text-xs rounded bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-500/20 transition-colors"
                  title={t('review.copy', '복사')}
                >
                  {t('review.copy', '복사')}
                </button>
              )}
              {issue.suggestedFix && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(issue.id)}
                  className="h-7 px-2 text-xs rounded bg-editor-surface text-editor-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                  title={t('review.ignore', '무시')}
                >
                  {t('review.ignore', '무시')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
