import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewIssue, IssueType, IssueSeverity } from '@/stores/reviewStore';
import { stripMarkdownInline } from '@/utils/normalizeForSearch';
import { stripHtml } from '@/utils/hash';

/** 컬럼 기본 너비 비율(%) — 통합 / 수정 제안 / 설명 */
const DEFAULT_COL_PCT: [number, number, number] = [16.67, 50, 33.33];
/** 각 컬럼 최소 너비(%) */
const MIN_COL_PCT = 8;

interface ReviewResultsTableProps {
  issues: ReviewIssue[];
  onToggleCheck?: (issueId: string) => void;
  onToggleAll?: () => void;
  onDelete?: (issueId: string) => void;
  onCopy?: (issue: ReviewIssue) => void;
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
  allChecked = false,
  totalIssuesFound = 0,
  severityFilter,
  onToggleSeverity,
}: ReviewResultsTableProps): JSX.Element {
  const { t } = useTranslation();

  // 컬럼 너비(%) 상태 — 드래그로 조정. 합은 항상 100% 유지(인접 컬럼 간 교환).
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [colPct, setColPct] = useState<[number, number, number]>(DEFAULT_COL_PCT);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startLeft: number;
    startRight: number;
    totalPx: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const totalPx = tableScrollRef.current?.clientWidth ?? 0;
      if (totalPx <= 0) return;
      dragRef.current = {
        index,
        startX: e.clientX,
        startLeft: colPct[index]!,
        startRight: colPct[index + 1]!,
        totalPx,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [colPct],
  );

  const resetColumnWidths = useCallback(() => setColPct(DEFAULT_COL_PCT), []);

  useEffect(() => {
    const handleMove = (e: MouseEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaPct = ((e.clientX - drag.startX) / drag.totalPx) * 100;
      const minDelta = -(drag.startLeft - MIN_COL_PCT);
      const maxDelta = drag.startRight - MIN_COL_PCT;
      const clamped = Math.max(minDelta, Math.min(maxDelta, deltaPct));
      setColPct((prev) => {
        const next: [number, number, number] = [prev[0], prev[1], prev[2]];
        next[drag.index] = drag.startLeft + clamped;
        next[drag.index + 1] = drag.startRight - clamped;
        return next;
      });
    };
    const handleUp = (): void => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

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

      {/* 테이블 - 컬럼 순서: 통합 컬럼(체크|#|심각도|유형) | 수정 제안 | 설명
          컬럼 너비는 colgroup으로 제어하며, 헤더 경계의 핸들을 드래그해 조정 */}
      <div ref={tableScrollRef} className="overflow-x-auto flex-1 overflow-y-auto border border-editor-border rounded-md min-h-0">
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col style={{ width: `${colPct[0]}%` }} />
            <col style={{ width: `${colPct[1]}%` }} />
            <col style={{ width: `${colPct[2]}%` }} />
          </colgroup>
          <thead className="sticky top-0 bg-editor-surface z-10">
            <tr className="border-b border-editor-border">
              {/* 통합 컬럼 헤더 */}
              <th className="relative px-2 py-2 text-center font-medium text-editor-muted">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => onToggleAll?.()}
                  className="w-3.5 h-3.5 rounded border-editor-border text-primary-500 focus:ring-primary-500 cursor-pointer"
                  aria-label={t('review.selectAll', '전체 선택')}
                />
                <span
                  role="separator"
                  aria-orientation="vertical"
                  title={t('review.resizeColumn', '열 너비 조정 (더블클릭 시 초기화)')}
                  onMouseDown={handleResizeStart(0)}
                  onDoubleClick={resetColumnWidths}
                  className="absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary-500/40 active:bg-primary-500/60 transition-colors select-none"
                />
              </th>
              {/* 수정 제안 */}
              <th className="relative px-3 py-2 text-left font-medium text-editor-muted">
                {t('review.suggestedFix', '수정 제안')}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  title={t('review.resizeColumn', '열 너비 조정 (더블클릭 시 초기화)')}
                  onMouseDown={handleResizeStart(1)}
                  onDoubleClick={resetColumnWidths}
                  className="absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary-500/40 active:bg-primary-500/60 transition-colors select-none"
                />
              </th>
              {/* 설명 */}
              <th className="px-3 py-2 text-left font-medium text-editor-muted">
                {t('review.description', '설명')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredIssues.map((issue, idx) => (
              <tr
                key={issue.id}
                className={`
                  border-b border-editor-border/50 hover:bg-editor-bg/50 transition-colors
                  ${issue.checked ? 'bg-primary-500/5' : ''}
                `}
              >
                {/* 통합 컬럼: 체크박스, #, 심각도, 유형을 세로로 배치 */}
                <td className="px-2 py-2 align-top">
                  <div className="flex flex-col items-center gap-1.5">
                    {/* 체크박스 */}
                    <input
                      type="checkbox"
                      checked={issue.checked}
                      onChange={() => onToggleCheck?.(issue.id)}
                      className="w-3.5 h-3.5 rounded border-editor-border text-primary-500 focus:ring-primary-500 cursor-pointer"
                      aria-label={t('review.selectIssue', '이슈 선택')}
                    />
                    {/* 번호 */}
                    <span className="text-editor-muted font-medium text-[10px]">
                      {idx + 1}
                    </span>
                    {/* 심각도 */}
                    <span className={`text-[10px] font-medium ${getSeverityColor(issue.severity)}`}>
                      {t(severityLabelKeys[issue.severity])}
                    </span>
                    {/* 유형 */}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${getIssueTypeColor(issue.type)}`}>
                      {t(issueTypeLabelKeys[issue.type])}
                    </span>
                  </div>
                </td>
                {/* 수정 제안 */}
                <td className="px-3 py-2 text-editor-text text-xs align-top">
                  <div className="flex flex-col gap-1.5">
                    <span className="break-words">
                      {issue.suggestedFix ? stripHtml(issue.suggestedFix).trim() : '-'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {issue.suggestedFix && onCopy && (
                        <button
                          type="button"
                          onClick={() => onCopy(issue)}
                          className="px-1.5 py-0.5 text-xs rounded bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-500/20 transition-colors"
                          title={t('review.copy', '복사')}
                        >
                          {t('review.copy', '복사')}
                        </button>
                      )}
                      {issue.suggestedFix && onDelete && (
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
                {/* 설명 (bullet 없음) */}
                <td className="px-3 py-2 text-editor-text text-xs align-top">
                  {issue.description ? (
                    <div className="space-y-0.5">
                      {stripMarkdownInline(issue.description).split(' | ').map((item, i) => (
                        <div key={`${issue.id}-desc-${i}`} className="break-words">{item}</div>
                      ))}
                    </div>
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
