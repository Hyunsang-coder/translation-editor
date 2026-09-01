import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { AlignOp } from '@/utils/alignUnits';
import type { TranslationUnit } from '@/editor/extensions/TranslationUnitId';
import type { UnitAnnotations } from '@/components/editor/useAlignmentAnnotations';
import type { IssueSeverity } from '@/stores/reviewStore';

/** 배지 색은 검수 패널의 심각도 색을 그대로 쓴다 */
function severityBadgeClass(severity: IssueSeverity | null): string {
  switch (severity) {
    case 'critical':
      return 'bg-severity-critical/10 text-severity-critical-deep';
    case 'major':
      return 'bg-severity-major/10 text-severity-major-deep';
    default:
      return 'bg-primary-500/10 text-accent-deep';
  }
}

interface AlignmentRowProps {
  /** 표시 번호 (ops 기준 1-based — 불일치 행이 섞여도 번호가 밀리지 않는다) */
  index: number;
  op: AlignOp;
  active: boolean;
  /** 정상 쌍만 선택할 수 있다. 불일치 행은 null (구간 배너의 버튼으로 이동한다) */
  onSelect: (() => void) | null;
  /** 활성 행에서만 노출되는 "이 문단 편집" — 문서 보기로 전환하고 커서를 옮긴다 */
  onEdit: (() => void) | null;
  /** 이 행에 매핑된 이슈·코멘트. 매핑된 게 없으면 null */
  annotations: UnitAnnotations | null;
  /**
   * 이슈 배지를 눌렀을 때. 한 행에 여러 이슈가 걸릴 수 있으므로 배지는 개별 이슈
   * 선택 UI가 아니라 "문서 순서상 첫 이슈로 이동" 버튼이다 — 특정 이슈를 고르는
   * 것은 검수 패널의 카드 몫이다.
   */
  onNavigateIssue: ((issueId: string) => void) | null;
}

/** heading은 본문보다 크게 — 표에서도 문서 구조가 읽히도록. */
function unitTextClass(unit: TranslationUnit): string {
  if (unit.type !== 'heading') return 'text-sm leading-relaxed';
  return unit.level === 1 ? 'text-lg font-bold leading-snug' : 'text-base font-bold leading-snug';
}

/**
 * 정렬 검사 뷰의 행 하나. 읽기 전용 — 여기서 편집하지 않는다.
 *
 * 정상 쌍(1:1)은 클릭해 선택할 수 있고, 짝이 없는 쪽(1:0 / 0:1)은 빈 셀
 * 플레이스홀더로 표시한다. **짝을 추정하지 않는다** — 틀린 짝을 믿게 하느니
 * 불일치를 그대로 드러낸다.
 */
export function AlignmentRow({
  index,
  op,
  active,
  onSelect,
  onEdit,
  annotations,
  onNavigateIssue,
}: AlignmentRowProps): JSX.Element {
  const { t } = useTranslation();

  const isPair = op.kind === 'pair';
  const source = op.kind === 'target-only' ? null : op.source;
  const target = op.kind === 'source-only' ? null : op.target;
  const cellBorder = isPair ? 'border-editor-border/40' : 'border-severity-major/20';

  const placeholderClass =
    'block w-full px-3 py-2.5 border border-dashed border-severity-major rounded '
    + 'text-xs text-severity-major bg-white/50';

  return (
    <div
      role="row"
      {...(onSelect ? { tabIndex: 0, onClick: onSelect } : {})}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex items-stretch ${
        isPair
          ? `border-b border-editor-hairline/40 cursor-pointer ${
            active ? 'bg-accent-tint border-l-[3px] border-l-primary-500' : 'hover:bg-editor-bg'
          }`
          : ''
      }`}
      data-testid="alignment-row"
      data-kind={op.kind}
      data-active={active}
    >
      {/* 활성 행은 좌측 3px 보더가 붙으므로 번호 셀을 그만큼 줄여 컬럼이 밀리지 않게 한다 */}
      <div
        className={`shrink-0 pt-3.5 text-xs font-bold tabular-nums ${
          active ? 'w-[49px] pl-[15px]' : 'w-[52px] pl-[18px]'
        } ${active ? 'text-primary-500' : isPair ? 'text-editor-muted/70' : 'text-severity-major'}`}
      >
        {String(index).padStart(2, '0')}
      </div>

      {source ? (
        <div className={`flex-1 min-w-0 px-5 py-3 border-l ${cellBorder} ${unitTextClass(source)}`}>
          {source.text}
        </div>
      ) : (
        <div className={`flex-1 min-w-0 px-5 py-3 border-l ${cellBorder} flex items-center`}>
          <span className={placeholderClass}>{t('editor.alignment.mismatch.noSource')}</span>
        </div>
      )}

      {target ? (
        <div className={`flex-1 min-w-0 px-5 py-3 border-l ${cellBorder} ${unitTextClass(target)}`}>
          {target.text}
          {active && onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="ml-2.5 h-6 px-2.5 inline-flex items-center align-middle border border-primary-500 bg-white rounded text-[11px] font-bold text-accent-deep hover:bg-accent-tint transition-colors"
              data-testid="alignment-row-edit"
            >
              {t('editor.alignment.editUnit')}
            </button>
          )}
        </div>
      ) : (
        <div className={`flex-1 min-w-0 px-5 py-3 border-l ${cellBorder} flex items-center`}>
          <span className={placeholderClass}>{t('editor.alignment.mismatch.noTarget')}</span>
        </div>
      )}

      <div className={`w-[120px] shrink-0 pl-[14px] py-3 border-l ${cellBorder} flex flex-col items-start gap-[5px]`}>
        {isPair ? (
          <span className="flex items-start gap-1 text-[11px] font-semibold text-editor-muted">
            <Check size={12} className="mt-[3px] shrink-0" />
            1:1
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-severity-major/20 text-severity-major-deep">
            {op.kind === 'source-only' ? '1:0' : '0:1'}
          </span>
        )}
        {annotations && annotations.issueCount > 0 && (() => {
          const badgeClass = `px-1.5 py-0.5 rounded text-[10px] font-bold ${severityBadgeClass(annotations.topSeverity)}`;
          const label = t('editor.alignment.issueBadge', { count: annotations.issueCount });
          const firstIssueId = annotations.issueIds[0];
          if (!onNavigateIssue || !firstIssueId) {
            return (
              <span className={badgeClass} data-testid="alignment-issue-badge">{label}</span>
            );
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateIssue(firstIssueId);
              }}
              // 버튼의 Enter/Space가 행 선택까지 실행되지 않게 막는다
              // (행의 keydown은 preventDefault를 하므로 두면 클릭 자체가 죽는다)
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
              aria-label={t('editor.alignment.viewIssue', { count: annotations.issueCount })}
              className={`${badgeClass} hover:brightness-95 active:scale-95 transition-transform cursor-pointer`}
              data-testid="alignment-issue-badge"
            >
              {label}
            </button>
          );
        })()}
        {annotations && annotations.commentCount > 0 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-editor-surface text-editor-muted"
            data-testid="alignment-comment-badge"
          >
            {t('editor.alignment.commentBadge', { count: annotations.commentCount })}
          </span>
        )}
      </div>
    </div>
  );
}
