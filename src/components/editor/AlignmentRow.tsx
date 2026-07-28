import { Check } from 'lucide-react';
import type { TranslationUnit } from '@/editor/extensions/TranslationUnitId';

interface AlignmentRowProps {
  /** 표시 번호 (ops 기준 1-based — 불일치 행이 섞여도 번호가 밀리지 않는다) */
  index: number;
  source: TranslationUnit;
  target: TranslationUnit;
  active: boolean;
  onSelect: () => void;
}

/** heading은 본문보다 크게 — 표에서도 문서 구조가 읽히도록. */
function unitTextClass(unit: TranslationUnit): string {
  if (unit.type !== 'heading') return 'text-sm leading-relaxed';
  return unit.level === 1 ? 'text-lg font-bold leading-snug' : 'text-base font-bold leading-snug';
}

/**
 * 정렬 검사 뷰의 정상 쌍(1:1) 행. 읽기 전용 — 여기서 편집하지 않는다.
 * 불일치 구간(1:0 / 0:1)은 4단계에서 별도로 그린다.
 */
export function AlignmentRow({ index, source, target, active, onSelect }: AlignmentRowProps): JSX.Element {
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex items-stretch border-b border-editor-border/40 cursor-pointer ${
        active ? 'bg-accent-tint border-l-[3px] border-l-primary-500' : 'hover:bg-editor-bg'
      }`}
      data-testid="alignment-row"
      data-active={active}
    >
      {/* 활성 행은 좌측 3px 보더가 붙으므로 번호 셀을 그만큼 줄여 컬럼이 밀리지 않게 한다 */}
      <div
        className={`shrink-0 pt-3.5 text-xs font-bold tabular-nums ${
          active ? 'w-[49px] pl-[15px] text-primary-500' : 'w-[52px] pl-[18px] text-slate-400'
        }`}
      >
        {String(index).padStart(2, '0')}
      </div>

      <div className={`flex-1 min-w-0 px-5 py-3 border-l border-editor-border/40 ${unitTextClass(source)}`}>
        {source.text}
      </div>

      <div className={`flex-1 min-w-0 px-5 py-3 border-l border-editor-border/40 ${unitTextClass(target)}`}>
        {target.text}
      </div>

      <div className="w-[120px] shrink-0 pl-[14px] py-3 border-l border-editor-border/40 flex items-start gap-1 text-[11px] font-semibold text-editor-muted">
        <Check size={12} className="mt-[3px] shrink-0" />
        <span>1:1</span>
      </div>
    </div>
  );
}
