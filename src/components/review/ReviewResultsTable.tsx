import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewIssue, IssueType, IssueSeverity } from '@/stores/reviewStore';
import { useUIStore } from '@/stores/uiStore';
import { scrollContainerToElement } from '@/editor/utils/reviewIssueNavigation';
import { stripRichTextMarkup } from '@/utils/normalizeForSearch';
import { sortReviewIssuesByDocumentOrder } from './reviewIssueOrder';
import { getIssueTypeColor, getSeverityColor, getSeverityChipColor } from './issueStyles';

interface ReviewResultsTableProps {
  issues: ReviewIssue[];
  onToggleCheck?: (issueId: string) => void;
  onToggleAll?: () => void;
  onIgnore?: (issueId: string) => void;
  onCopy?: (issue: ReviewIssue) => void;
  onApply?: (issue: ReviewIssue) => void;
  /** 카드 클릭 → 원문·번역문 패널을 그 이슈 위치로 이동 */
  onNavigate?: (issueId: string) => void;
  /** 목록 안에서 해당 카드가 보이도록 이동해 달라는 일회성 요청 */
  pendingScrollIssue?: { issueId: string; requestId: number } | null;
  onPendingScrollHandled?: (requestId: number) => void;
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

/** 이동한 카드와 sticky 헤더 사이에 두는 여백 */
const CARD_TOP_GAP_PX = 8;

const severityLabelKeys: Record<IssueSeverity, string> = {
  critical: 'review.severityCritical',
  major: 'review.severityMajor',
  minor: 'review.severityMinor',
};

export function ReviewResultsTable({
  issues,
  onToggleCheck,
  onToggleAll,
  onIgnore,
  onCopy,
  onApply,
  onNavigate,
  pendingScrollIssue,
  onPendingScrollHandled,
  allChecked = false,
  totalIssuesFound = 0,
  severityFilter,
  onToggleSeverity,
}: ReviewResultsTableProps): JSX.Element {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  /**
   * 카드 이동 요청 소비. 스크롤 대상은 **카드 목록 컨테이너**다 —
   * `scrollIntoView()`에 맡기면 바깥 패널까지 함께 움직인다.
   * 필터로 숨겨졌거나 이미 사라진 카드는 이동만 건너뛰고 요청은 소비한다(stale 방지).
   */
  useEffect(() => {
    if (!pendingScrollIssue) return;
    const list = listRef.current;
    const card = list
      ? Array.from(list.querySelectorAll<HTMLElement>('[data-issue-id]'))
        .find((el) => el.getAttribute('data-issue-id') === pendingScrollIssue.issueId)
      : undefined;
    if (list && card) {
      // "전체 선택" 헤더가 sticky라 목록 최상단은 헤더에 가린다 — 그 높이만큼 더 띄운다
      const header = list.querySelector<HTMLElement>('[data-review-list-header]');
      scrollContainerToElement(
        list,
        card,
        useUIStore.getState().editorZoom,
        (header?.offsetHeight ?? 0) + CARD_TOP_GAP_PX,
      );
    }
    onPendingScrollHandled?.(pendingScrollIssue.requestId);
  }, [pendingScrollIssue, onPendingScrollHandled]);

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

  // severity 필터 적용 후 문서 위→아래 순서로 표시
  const filteredIssues = useMemo(
    () => sortReviewIssuesByDocumentOrder(
      severityFilter
        ? issues.filter((issue) => severityFilter.includes(issue.severity))
        : issues,
    ),
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
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-diff-insertion/10 mb-3">
          <svg className="w-6 h-6 text-diff-insertion" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm text-diff-insertion font-semibold">
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
                className={`px-2 py-0.5 rounded-full text-[10px] active:scale-95 transition-colors cursor-pointer ${
                  !severityFilter || severityFilter.includes('critical')
                    ? getSeverityChipColor('critical')
                    : 'bg-editor-surface text-editor-muted/60'
                }`}
              >
                {t(severityLabelKeys.critical)} {severityCounts.critical}
              </button>
            ) : null}
            {severityCounts.major ? (
              <button
                type="button"
                onClick={() => onToggleSeverity?.('major')}
                className={`px-2 py-0.5 rounded-full text-[10px] active:scale-95 transition-colors cursor-pointer ${
                  !severityFilter || severityFilter.includes('major')
                    ? getSeverityChipColor('major')
                    : 'bg-editor-surface text-editor-muted/60'
                }`}
              >
                {t(severityLabelKeys.major)} {severityCounts.major}
              </button>
            ) : null}
            {severityCounts.minor ? (
              <button
                type="button"
                onClick={() => onToggleSeverity?.('minor')}
                className={`px-2 py-0.5 rounded-full text-[10px] active:scale-95 transition-colors cursor-pointer ${
                  !severityFilter || severityFilter.includes('minor')
                    ? getSeverityChipColor('minor')
                    : 'bg-editor-surface text-editor-muted/60'
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
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-editor-surface text-editor-muted">
              {t('review.typeMistranslation', '오역')} {counts.mistranslation}
            </span>
          )}
          {counts.omission && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-editor-surface text-editor-muted">
              {t('review.typeOmission', '누락')} {counts.omission}
            </span>
          )}
          {counts.addition && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-editor-surface text-editor-muted">
              {t('review.typeAddition', '추가')} {counts.addition}
            </span>
          )}
          {counts.grammar && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-editor-surface text-editor-muted">
              {t('review.typeGrammar', '문법')} {counts.grammar}
            </span>
          )}
          {counts.awkward && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-editor-surface text-editor-muted">
              {t('review.typeAwkward', '직역투')} {counts.awkward}
            </span>
          )}
          {counts.terminology && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-editor-surface text-editor-muted">
              {t('review.typeTerminology', '용어')} {counts.terminology}
            </span>
          )}
        </div>
      </div>

      {/* 이슈 카드 리스트 — 250px 사이드바에서 3열 table-fixed가 뭉개지던 것을 대체 */}
      <div ref={listRef} className="flex-1 overflow-y-auto border border-editor-border rounded-md min-h-0">
        <label
          data-review-list-header
          className="sticky top-0 z-10 flex items-center gap-2 px-3.5 py-2 bg-editor-surface border-b border-editor-hairline text-[11px] text-editor-muted cursor-pointer"
        >
          <input
            type="checkbox"
            checked={allChecked}
            onChange={() => onToggleAll?.()}
            className="w-3.5 h-3.5 rounded border-editor-border text-primary-500 focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 cursor-pointer"
            aria-label={t('review.selectAll', '전체 선택')}
          />
          <span>{t('review.selectAll', '전체 선택')}</span>
        </label>

        {filteredIssues.map((issue, idx) => (
          <div
            key={issue.id}
            data-testid="review-issue-card"
            data-issue-id={issue.id}
            {...(onNavigate
              ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': t('review.navigateIssue', '이 이슈 위치로 이동'),
                // 카드 안의 조작(체크박스·적용·복사·무시)은 그 자체 동작만 한다
                onClick: (e: React.MouseEvent<HTMLDivElement>) => {
                  if ((e.target as HTMLElement).closest('button, input, a, label')) return;
                  // 카드 안 구절을 드래그해 복사하는 중이면 이동하지 않는다 —
                  // mouseup에서도 click이 뜨고, 이동은 포커스를 옮겨 선택을 지운다.
                  const selection = window.getSelection();
                  if (
                    selection
                    && !selection.isCollapsed
                    && e.currentTarget.contains(selection.anchorNode)
                  ) return;
                  onNavigate(issue.id);
                },
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onNavigate(issue.id);
                },
              }
              : {})}
            className={`
              p-3.5 border-b border-editor-hairline border-l-[3px] transition-colors
              ${issue.checked
                ? 'bg-accent-tint border-l-primary-500'
                : 'border-l-transparent hover:bg-editor-bg/50'}
              ${onNavigate ? 'cursor-pointer' : ''}
            `}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={issue.checked}
                onChange={() => onToggleCheck?.(issue.id)}
                className="w-3.5 h-3.5 shrink-0 rounded border-editor-border text-primary-500 focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 cursor-pointer"
                aria-label={t('review.selectIssue', '이슈 선택')}
              />
              <span className={`text-[10px] font-bold ${getSeverityColor(issue.severity)}`}>
                {t(severityLabelKeys[issue.severity])}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${getIssueTypeColor(issue.type)}`}>
                {t(issueTypeLabelKeys[issue.type])}
              </span>
              <span className="ml-auto text-[10px] text-editor-muted tabular-nums">{idx + 1}</span>
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
                  className="h-[30px] px-2.5 text-xs rounded bg-primary-fill text-white hover:bg-primary-fill-hover active:scale-95 transition-colors"
                  title={t('review.apply', '적용')}
                >
                  {t('review.apply', '적용')}
                </button>
              )}
              {issue.suggestedFix && onCopy && (
                <button
                  type="button"
                  onClick={() => onCopy(issue)}
                  className="h-[30px] px-2.5 text-xs rounded bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-500/20 active:scale-95 transition-colors"
                  title={t('review.copy', '복사')}
                >
                  {t('review.copy', '복사')}
                </button>
              )}
              {onIgnore && (
                <button
                  type="button"
                  onClick={() => onIgnore(issue.id)}
                  className="h-[30px] px-2.5 text-xs rounded bg-editor-surface text-editor-muted hover:bg-editor-border hover:text-editor-text active:scale-95 transition-colors"
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
