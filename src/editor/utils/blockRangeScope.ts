import type { Editor } from '@tiptap/core';
import {
  collectTranslationUnits,
  getTranslationUnitIdsAtRange,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';

/**
 * 에디터의 현재 선택을 **최상위 블록 구간**으로 해석한다 (범위 실행의 공통 진입).
 *
 * 범위는 항상 최상위 블록 단위로 넓힌다. 표 안을 선택하면 표 전체가 구간이 된다 —
 * 유닛에 tableCell이 포함되므로 셀 단위로 잘라 보내면 표 구조가 깨진 마크다운이
 * 모델에 들어간다(셀 단위 절단 금지).
 *
 * 유닛이 하나도 없는 선택(비유닛 블록만 고른 경우)은 null이다 — 보낼 번역 단위가
 * 없는데 구간만 잡으면 결과를 되돌려 놓을 기준이 없다.
 */
export interface TopLevelBlockRange {
  /** 최상위 content 배열에서의 시작 인덱스 (포함) */
  fromIndex: number;
  /** 최상위 content 배열에서의 끝 인덱스 (포함) */
  toIndex: number;
  /** 구간에 포함된 선택 유닛 수 — UI 라벨용 */
  unitCount: number;
}

export function resolveTopLevelBlockRange(editor: Editor): TopLevelBlockRange | null {
  if (editor.isDestroyed) return null;

  const { from, to, empty } = editor.state.selection;
  if (empty) return null;

  const selectedIds = new Set(getTranslationUnitIdsAtRange(editor.state.doc, from, to));
  if (selectedIds.size === 0) return null;

  const units = collectTranslationUnits(editor.getJSON() as TranslationUnitDocument).filter(
    (unit) => unit.id && selectedIds.has(unit.id),
  );

  let fromIndex = Number.POSITIVE_INFINITY;
  let toIndex = Number.NEGATIVE_INFINITY;
  for (const unit of units) {
    const top = unit.path[0];
    if (typeof top !== 'number') continue;
    if (top < fromIndex) fromIndex = top;
    if (top > toIndex) toIndex = top;
  }

  if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return null;

  return { fromIndex, toIndex, unitCount: units.length };
}
