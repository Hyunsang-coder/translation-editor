import {
  collectTranslationUnits,
  type TranslationUnit,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';
import type { TipTapDocJson } from '@/utils/markdownConverter';
import { signature } from '@/utils/alignUnits';

/**
 * "이어서 번역"의 경계 판정 (순수 함수, 영속화 없음).
 *
 * 이미 번역된 앞부분의 끝(k)을 찾아, 그 뒤에 남은 원문 suffix만 번역 범위로
 * 돌려준다. 중간에 뚫린 구멍은 다루지 않는다 — 중간 구간 교체는 모델의
 * N유닛→N유닛 개수 일치율이 측정되지 않아 보류된 문제(ADR-0010)다.
 *
 * ## 왜 alignUnits(LCS)를 쓰지 않는가
 *
 * `signature()`는 텍스트를 보지 않으므로(원문↔번역문은 언어가 달라 내용 비교가
 * 무의미) 같은 타입 블록이 연속되면 정렬이 완전히 모호해진다. 그 모호함을
 * `alignUnits`의 백트래킹은 **뒤쪽으로** 푼다 — 원문 A,B,C,D에 A,B의 번역만 있는
 * 문서에서 ops는 `src-only(A), src-only(B), pair(C→…), pair(D→…)`가 된다.
 * 그래서 "pair의 최대 인덱스"는 늘 문서 끝이 되고, 이 기능이 노리는 부분 번역
 * 문서에서 남은 구간이 항상 0으로 나온다. `ratio` 게이트는 방향이 더 나쁘다 —
 * 덜 번역했을수록(=이어서 번역이 더 필요할수록) 비율이 낮아 차단된다.
 *
 * 대신 이 모듈은 이 기능의 실제 전제를 직접 검증한다: **번역문은 원문 prefix의
 * 번역이다.** 앞에서부터 M개(=번역문 유닛 수)를 시그니처로 맞춰보고, 하나라도
 * 어긋나면 기능을 끈다(fail-closed). 억지로 경계를 정하는 것보다 "전체 실행하세요"가
 * 언제나 안전하다.
 *
 * 한계(의도된 것): 전부 같은 타입인 문서에서 번역가가 중간 한 문단을 건너뛰었다면
 * 시그니처만으로는 구분할 수 없다. 이 경우 경계가 한 칸 밀리지만, 결과는 프리뷰
 * diff로 보이고 선택 적용으로 걸러낼 수 있다 — 문서를 손상시키는 경로가 아니다.
 */

/** 문체·용어를 이어가도록 프롬프트에 넣는 직전 번역 쌍의 개수. */
export const CONTINUE_CONTEXT_PAIRS = 3;

/** 참고 쌍의 유닛당 텍스트 상한 (retranslateSelection.ts의 유닛당 상한과 같은 기준). */
export const CONTINUE_CONTEXT_MAX_CHARS = 400;

export interface ContinuationPlan {
  /** source.content.slice(k+1)로 만든 sub-doc. 번역 파이프라인에 그대로 투입한다. */
  remainingSourceDoc: TipTapDocJson;
  /** remainingSourceDoc의 최상위 블록 수 (비유닛 블록 포함). */
  remainingBlockCount: number;
  /** 번역이 남은 원문 유닛 수 — 버튼 라벨에 쓴다. */
  remainingUnitCount: number;
  /** 경계 블록 안에서 대응을 못 찾은 원문 유닛 수 (정보용 — 범위에 넣지 않는다). */
  middleGapUnitCount: number;
  /** 직전 번역 참고 쌍 (마지막 CONTINUE_CONTEXT_PAIRS개, 유닛당 400자 컷). */
  contextPairs: Array<{ source: string; target: string }>;
}

export type ContinuationUnavailableReason =
  /** 번역문이 비어 있다 — "이어서"가 아니라 첫 번역이다. */
  | 'empty-target'
  /** 번역문이 원문 prefix의 번역이 아니다 (시그니처 불일치). */
  | 'misaligned-prefix'
  /** 남은 원문이 없다. */
  | 'nothing-remaining';

export type ContinuationPlanResult =
  | { ok: true; plan: ContinuationPlan }
  | { ok: false; reason: ContinuationUnavailableReason };

function truncateContextText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > CONTINUE_CONTEXT_MAX_CHARS
    ? `${trimmed.slice(0, CONTINUE_CONTEXT_MAX_CHARS)}…`
    : trimmed;
}

/**
 * 빈 문단은 제외한다 — 번역 과정에서 빈 문단 개수가 흔히 달라져 포함하면 경계가
 * 쉽게 어긋난다. `alignUnits.contentUnits`와 같은 규칙이다.
 */
export function contentUnits(doc: TipTapDocJson): TranslationUnit[] {
  return collectTranslationUnits(doc as TranslationUnitDocument).filter(
    (unit) => unit.text.trim().length > 0,
  );
}

/**
 * 유닛 목록에서 경계를 판정한다. `buildContinuationPlan`이 문서에서 유닛을 뽑아
 * 이 함수에 넘긴다 — 게이트를 유닛 리터럴만으로 테스트할 수 있게 분리했다.
 */
export function planFromUnits(
  sourceUnits: TranslationUnit[],
  targetUnits: TranslationUnit[],
  sourceDocJson: TipTapDocJson,
): ContinuationPlanResult {
  if (targetUnits.length === 0) return { ok: false, reason: 'empty-target' };
  if (targetUnits.length >= sourceUnits.length) return { ok: false, reason: 'nothing-remaining' };

  // 전제 검증: 번역문 M개가 원문 앞 M개와 구조적으로 대응하는가.
  const translatedCount = targetUnits.length;
  for (let i = 0; i < translatedCount; i += 1) {
    const sourceUnit = sourceUnits[i];
    const targetUnit = targetUnits[i];
    if (!sourceUnit || !targetUnit) return { ok: false, reason: 'misaligned-prefix' };
    if (signature(sourceUnit) !== signature(targetUnit)) {
      return { ok: false, reason: 'misaligned-prefix' };
    }
  }

  // k = 번역된 마지막 유닛이 속한 최상위 블록. 범위는 항상 최상위 블록 단위로
  // 넓힌다 — 일부만 번역된 표는 k가 그 표를 가리키게 되어 통째로 제외된다
  // (셀 단위 절단 금지).
  const lastTranslated = sourceUnits[translatedCount - 1];
  const k = lastTranslated?.path[0];
  if (typeof k !== 'number') return { ok: false, reason: 'misaligned-prefix' };

  const remainingUnitCount = sourceUnits.filter((unit) => (unit.path[0] ?? -1) > k).length;
  if (remainingUnitCount === 0) return { ok: false, reason: 'nothing-remaining' };

  // 경계 블록(k)에 남은 미대응 유닛 — 예: 절반만 번역된 표의 나머지 셀들.
  const middleGapUnitCount = sourceUnits
    .slice(translatedCount)
    .filter((unit) => (unit.path[0] ?? -1) <= k).length;

  const sourceContent = Array.isArray(sourceDocJson.content) ? sourceDocJson.content : [];
  // 비유닛 블록(hr 등)도 슬라이스에 포함된다 — 의도된 동작. 경계 부근의 비유닛
  // 블록이 target 끝에 이미 있으면 중복될 수 있으나, 프리뷰 diff에서 보이고
  // 선택 적용으로 제외할 수 있다.
  const remainingContent = sourceContent.slice(k + 1);

  const contextPairs: Array<{ source: string; target: string }> = [];
  for (let i = Math.max(0, translatedCount - CONTINUE_CONTEXT_PAIRS); i < translatedCount; i += 1) {
    const sourceUnit = sourceUnits[i];
    const targetUnit = targetUnits[i];
    if (!sourceUnit || !targetUnit) continue;
    contextPairs.push({
      source: truncateContextText(sourceUnit.text),
      target: truncateContextText(targetUnit.text),
    });
  }

  return {
    ok: true,
    plan: {
      remainingSourceDoc: { ...sourceDocJson, content: remainingContent },
      remainingBlockCount: remainingContent.length,
      remainingUnitCount,
      middleGapUnitCount,
      contextPairs,
    },
  };
}

export function buildContinuationPlan(
  sourceDocJson: TipTapDocJson,
  targetDocJson: TipTapDocJson,
): ContinuationPlanResult {
  return planFromUnits(contentUnits(sourceDocJson), contentUnits(targetDocJson), sourceDocJson);
}
