import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as Diff from 'diff';
import type { DocChangeUnit } from '@/utils/docBlockDiff';

interface SelectiveDiffListProps {
  units: DocChangeUnit[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (selected: boolean) => void;
}

/**
 * 폴리싱/재번역 미리보기의 변경 단위 선택 목록.
 * 문장/문단 단위 변경마다 체크박스 + 기존|제안 좌우 비교(단어 단위 하이라이트)를 표시합니다.
 */
export function SelectiveDiffList({
  units,
  selectedIds,
  onToggle,
  onToggleAll,
}: SelectiveDiffListProps): JSX.Element {
  const { t } = useTranslation();
  const selectedCount = units.filter((unit) => selectedIds.has(unit.id)).length;
  const allSelected = units.length > 0 && selectedCount === units.length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 헤더: 전체 선택 + 카운트 + 컬럼 라벨 */}
      <div className="shrink-0 border-b border-editor-hairline bg-editor-surface">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={(event) => onToggleAll(event.currentTarget.checked)}
              className="w-3.5 h-3.5 rounded border-editor-border text-primary-500 focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 cursor-pointer"
              aria-label={t('editor.selectiveDiff.selectAll', '전체 선택')}
            />
            <span className="text-xs text-editor-text">
              {t('editor.selectiveDiff.changedCount', '변경 {{total}}개 중 {{selected}}개 선택', {
                total: units.length,
                selected: selectedCount,
              })}
            </span>
          </label>
        </div>
        <div className="grid grid-cols-[auto_auto_1fr_1fr] gap-3 px-4 pb-2">
          <span className="w-3.5" aria-hidden />
          <span className="w-8" aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-wide text-severity-critical/80">
            {t('editor.selectiveDiff.original', '기존')}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-diff-insertion/80">
            {t('editor.selectiveDiff.suggested', '제안')}
          </span>
        </div>
      </div>

      {/* 변경 단위 목록 */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin divide-y divide-editor-border/50">
        {units.map((unit) => (
          <SelectiveDiffRow
            key={unit.id}
            unit={unit}
            selected={selectedIds.has(unit.id)}
            onToggle={() => onToggle(unit.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SelectiveDiffRow({
  unit,
  selected,
  onToggle,
}: {
  unit: DocChangeUnit;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  const isInsertion = unit.originalText.length === 0;
  const isDeletion = unit.polishedText.length === 0;

  // 단어 단위 diff (기존 칸에는 삭제, 제안 칸에는 삽입 하이라이트)
  const wordParts = useMemo(
    () => (isInsertion || isDeletion ? null : Diff.diffWords(unit.originalText, unit.polishedText)),
    [unit.originalText, unit.polishedText, isInsertion, isDeletion],
  );

  return (
    <label
      className={`grid grid-cols-[auto_auto_1fr_1fr] items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-editor-surface/60 ${
        selected ? 'bg-primary-500/5' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded border-editor-border text-primary-500 focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 cursor-pointer"
        aria-label={t('editor.selectiveDiff.selectChange', '변경 선택')}
      />
      <span className="mt-0.5 shrink-0 text-[10px] text-editor-muted font-medium tabular-nums w-8">
        {unit.blockLabel}
      </span>

      {/* 기존 (좌) */}
      <div className="min-w-0 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-editor-muted border-r border-editor-hairline/40 pr-3">
        {isInsertion ? (
          <span className="text-[10px] text-editor-muted/70 italic">—</span>
        ) : wordParts ? (
          wordParts.map((part, i) =>
            part.added ? null : part.removed ? (
              <span
                key={i}
                className="bg-severity-critical/20 dark:bg-severity-critical/50 text-severity-critical/10 line-through decoration-severity-critical decoration-1 rounded-[2px] px-0.5"
              >
                {part.value}
              </span>
            ) : (
              <span key={i}>{part.value}</span>
            ),
          )
        ) : (
          <>
            {unit.originalText}
            {isDeletion && (
              <span className="ml-1 text-[10px] text-severity-critical/80">
                {t('editor.selectiveDiff.removed', '(삭제)')}
              </span>
            )}
          </>
        )}
      </div>

      {/* 제안 (우) */}
      <div className="min-w-0 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-editor-text">
        {isDeletion ? (
          <span className="text-[10px] text-editor-muted/70 italic">—</span>
        ) : wordParts ? (
          wordParts.map((part, i) =>
            part.removed ? null : part.added ? (
              <span
                key={i}
                className="bg-diff-insertion/20 dark:bg-diff-insertion/50 text-diff-insertion/10 rounded-[2px] px-0.5"
              >
                {part.value}
              </span>
            ) : (
              <span key={i}>{part.value}</span>
            ),
          )
        ) : (
          <>
            {unit.polishedText}
            {isInsertion && (
              <span className="ml-1 text-[10px] text-diff-insertion/80">
                {t('editor.selectiveDiff.added', '(추가)')}
              </span>
            )}
          </>
        )}
      </div>
    </label>
  );
}
