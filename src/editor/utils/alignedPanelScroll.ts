import {
  collectTranslationUnits,
  type TranslationUnit,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';
import { alignUnits, signature } from '@/utils/alignUnits';

/**
 * 원문/번역문 패널의 스크롤 동기화에만 쓰는 고유 유닛 ID 대응표.
 *
 * 자동 스크롤은 한 번의 잘못된 이동도 사용자에게 매우 거슬리므로, 중복 ID나
 * degraded LCS처럼 대응을 확신할 수 없는 경우에는 fail-closed로 제외한다.
 */
export interface AlignedUnitMaps {
  sourceToTarget: Map<string, string>;
  targetToSource: Map<string, string>;
  degraded: boolean;
}

function contentUnits(doc: TranslationUnitDocument): TranslationUnit[] {
  return collectTranslationUnits(doc).filter((unit) => unit.text.trim().length > 0);
}

function uniqueUnitsById(units: TranslationUnit[]): Map<string, TranslationUnit> {
  const unique = new Map<string, TranslationUnit>();
  const duplicates = new Set<string>();

  for (const unit of units) {
    if (!unit.id) continue;
    if (unique.has(unit.id)) {
      unique.delete(unit.id);
      duplicates.add(unit.id);
      continue;
    }
    if (!duplicates.has(unit.id)) unique.set(unit.id, unit);
  }

  return unique;
}

function addPair(
  sourceToTarget: Map<string, string>,
  targetToSource: Map<string, string>,
  sourceId: string | undefined,
  targetId: string | undefined,
): void {
  if (!sourceId || !targetId) return;
  if (sourceToTarget.has(sourceId) || targetToSource.has(targetId)) return;
  sourceToTarget.set(sourceId, targetId);
  targetToSource.set(targetId, sourceId);
}

/**
 * ID 직접 매칭을 먼저 쓰고, 남은 고유 ID는 정렬 뷰와 동일한 LCS 결과로 보완한다.
 * LCS degraded 폴백은 구조가 전부 동일한 1:1일 때만 신뢰한다.
 */
export function buildAlignedUnitMaps(
  sourceDoc: TranslationUnitDocument,
  targetDoc: TranslationUnitDocument,
): AlignedUnitMaps {
  const sourceToTarget = new Map<string, string>();
  const targetToSource = new Map<string, string>();
  const sourceById = uniqueUnitsById(contentUnits(sourceDoc));
  const targetById = uniqueUnitsById(contentUnits(targetDoc));

  for (const [id] of sourceById) {
    if (!targetById.has(id)) continue;
    addPair(sourceToTarget, targetToSource, id, id);
  }

  const result = alignUnits(sourceDoc, targetDoc);
  const lcsIsSafe = !result.degraded || result.ops.every(
    (op) => op.kind === 'pair' && signature(op.source) === signature(op.target),
  );

  if (lcsIsSafe) {
    for (const op of result.ops) {
      if (op.kind !== 'pair') continue;
      const sourceId = op.source.id;
      const targetId = op.target.id;
      // LCS pair도 양쪽에서 유일한 ID여야 DOM 대상으로 특정할 수 있다.
      if (
        !sourceId ||
        !targetId ||
        !sourceById.has(sourceId) ||
        !targetById.has(targetId)
      ) {
        continue;
      }
      addPair(sourceToTarget, targetToSource, sourceId, targetId);
    }
  }

  return {
    sourceToTarget,
    targetToSource,
    degraded: result.degraded,
  };
}

export interface CounterpartScrollInput {
  /** follower anchor의 viewport 내 화면 좌표 */
  counterpartTop: number;
  /** follower scroll container의 viewport 상단 화면 좌표 */
  counterpartContainerTop: number;
  counterpartScrollTop: number;
  counterpartScrollHeight: number;
  counterpartClientHeight: number;
  /** leader anchor가 leader viewport 상단에서 떨어진 화면 px */
  primaryViewportOffset: number;
  /** MainLayout에 적용된 CSS zoom */
  zoom: number;
}

/**
 * follower anchor를 leader anchor와 같은 viewport offset으로 맞추는 scrollTop.
 * getBoundingClientRect는 CSS zoom이 적용된 화면 좌표이므로 scroll 좌표로 되돌릴 때
 * zoom을 나눠야 한다.
 */
export function resolveCounterpartScrollTop(
  input: CounterpartScrollInput,
): number | null {
  const effectiveZoom = input.zoom > 0 ? input.zoom : 1;
  const delta = (
    input.counterpartTop
    - input.counterpartContainerTop
    - input.primaryViewportOffset
  ) / effectiveZoom;
  const maxTop = Math.max(0, input.counterpartScrollHeight - input.counterpartClientHeight);
  const next = Math.min(
    Math.max(input.counterpartScrollTop + delta, 0),
    maxTop,
  );

  return Math.abs(next - input.counterpartScrollTop) < 1 ? null : next;
}
