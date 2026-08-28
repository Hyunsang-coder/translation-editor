import {
  collectTranslationUnits,
  type TranslationUnit,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';
import { alignUnits, signature } from '@/utils/alignUnits';

/**
 * 선택 유닛 ID에 대응하는 반대쪽 문서의 유닛을 찾는다. 방향 무관 —
 * 재번역·채팅은 Target 선택→Source, 검수 위치 힌트는 Source→Target으로 쓴다.
 *
 * 1차: translationUnitId 직접 매칭 (전체 번역/폴리싱 적용 시 reattach된 문서).
 * 2차: reattach 이전 legacy 문서는 두 에디터가 ID를 독립 발급해 매칭되지 않는다.
 *      이때는 정렬 뷰와 같은 LCS 정렬(alignUnits)로 짝짓는다 — 문단이 추가·삭제돼도
 *      나머지 유닛은 짝이 유지되고, 짝을 못 찾은 유닛만 실패한다. (예전의 "문서
 *      전체가 1:1일 때만" 순번 대응은 원문 한 문단만 고쳐도 문서 전체 재번역이
 *      죽는 문제가 있었다 — docs/aligned-unit-lookup-lcs-plan.md)
 *
 * `TranslationUnitId.ts`(유닛 수집)와 `alignUnits.ts`(LCS)를 조합하는 정책 모듈로
 * 분리한 이유: alignUnits가 이미 TranslationUnitId를 import하므로 역방향 import는
 * 런타임 순환이 된다.
 */
export function findAlignedCounterpartUnits(
  counterpartDoc: TranslationUnitDocument,
  primaryDoc: TranslationUnitDocument,
  selectedUnitIds: string[],
): TranslationUnit[] {
  const byUnitId = findAlignedCounterpartUnitMap(counterpartDoc, primaryDoc, selectedUnitIds);
  if (!byUnitId) return [];
  return [...byUnitId.values()].flat();
}

/**
 * 위와 같은 규칙으로 짝짓되, **선택 유닛 ID별로 나눠서** 돌려준다. 짝이 없다고
 * 판정되면 `null`(fail-closed). primary 문서에 아예 없는 ID는 키가 빠진 채
 * 돌아오므로 호출부가 유닛별로 확인해야 한다.
 *
 * 어느 원문이 어느 선택 유닛의 것인지 알아야 하는 호출부(범위 검수의 세그먼트
 * 구성)를 위한 형태다. `findAlignedCounterpartUnits`는 이걸 평탄화한 것이다.
 */
export function findAlignedCounterpartUnitMap(
  counterpartDoc: TranslationUnitDocument,
  primaryDoc: TranslationUnitDocument,
  selectedUnitIds: string[],
): Map<string, TranslationUnit[]> | null {
  const selectedIds = new Set(selectedUnitIds);
  const byId = new Map<string, TranslationUnit[]>();
  if (selectedIds.size === 0) return byId;

  // keepOnSplit 이력·붙여넣기로 같은 ID가 여러 유닛에 복제된 문서가 있으므로
  // 유닛 개수가 아니라 매칭된 고유 ID 수로 판정한다. 중복 유닛은 문서 순서
  // 그대로 모두 담는다 — 분할된 반쪽들을 합치면 원래 유닛 전체가 된다.
  for (const unit of collectTranslationUnits(counterpartDoc)) {
    if (!unit.id || !selectedIds.has(unit.id)) continue;
    const bucket = byId.get(unit.id);
    if (bucket) bucket.push(unit);
    else byId.set(unit.id, [unit]);
  }
  if (byId.size === selectedIds.size) return byId;
  // 일부만 맞는 혼합 상태에서 부분 원문을 반환하면 선택의 나머지가 조용히 빠진다.
  if (byId.size > 0) return null;

  const { ops, degraded } = alignUnits(counterpartDoc, primaryDoc);
  // LCS 상한 초과 시 alignUnits는 시그니처 검증 없는 순번 매칭으로 내려간다.
  // 그 결과는 예전 fallback 수준의 "전체 1:1 + 시그니처 일치"일 때만 신뢰한다.
  if (
    degraded &&
    !ops.every((op) => op.kind === 'pair' && signature(op.source) === signature(op.target))
  ) {
    return null;
  }

  // alignUnits(counterpartDoc, primaryDoc) 인자 순서상 op.source가 반대쪽,
  // op.target이 선택이 있는 쪽이다. 빈 유닛은 정렬 대상에서 제외돼 ops에 없다.
  const aligned = new Map<string, TranslationUnit[]>();
  for (const op of ops) {
    if (op.kind === 'pair') {
      if (!op.target.id || !selectedIds.has(op.target.id)) continue;
      const bucket = aligned.get(op.target.id);
      if (bucket) bucket.push(op.source);
      else aligned.set(op.target.id, [op.source]);
    } else if (op.kind === 'target-only') {
      // 선택 유닛에 짝이 없으면 추측하지 않는다 — 부분 결과 대신 실패.
      if (op.target.id && selectedIds.has(op.target.id)) return null;
    }
  }
  return aligned;
}
