/**
 * 통합 어휘 변환 (설계서 §4.2 / §4.3).
 *
 * 앱 내부 UI는 기존 IssueType 6종을 유지한다(§4.2 마지막 줄).
 * 장부에 쓸 때만 통합 값으로 변환한다 — 이 파일이 그 변환표.
 */

import type { IssueSeverity, IssueType } from '@/stores/reviewStore';
import type { UnifiedFindingType } from './types';

/**
 * 앱 IssueType → 통합 finding.type (§4.2 변환표).
 *
 * 앱 IssueType 6종의 매핑:
 * - omission       → accuracy.omission
 * - addition       → accuracy.addition
 * - mistranslation → accuracy.mistranslation
 * - grammar        → fluency.grammar
 * - awkward        → fluency.structure   (직역투/부자연스러운 구조)
 * - terminology    → terminology.violation
 */
const ISSUE_TYPE_TO_UNIFIED: Record<IssueType, UnifiedFindingType> = {
  omission: 'accuracy.omission',
  addition: 'accuracy.addition',
  mistranslation: 'accuracy.mistranslation',
  grammar: 'fluency.grammar',
  awkward: 'fluency.structure',
  terminology: 'terminology.violation',
};

/** 앱 IssueType을 장부용 통합 어휘로 변환한다. */
export function toUnifiedFindingType(type: IssueType): UnifiedFindingType {
  return ISSUE_TYPE_TO_UNIFIED[type] ?? 'fluency.wording';
}

/**
 * 통합 finding.type → 앱 IssueType (역변환, 외부에서 통합 어휘로 들어온 이슈를 UI에 태울 때).
 * accuracy.nuance 등 앱에 대응 IssueType이 없는 값은 가장 가까운 것으로 근사한다.
 */
const UNIFIED_TO_ISSUE_TYPE: Record<UnifiedFindingType, IssueType> = {
  'accuracy.omission': 'omission',
  'accuracy.addition': 'addition',
  'accuracy.mistranslation': 'mistranslation',
  'accuracy.nuance': 'mistranslation',
  'fluency.collocation': 'awkward',
  'fluency.wording': 'awkward',
  'fluency.structure': 'awkward',
  'fluency.grammar': 'grammar',
  'fluency.repetition': 'awkward',
  'fluency.verbosity': 'awkward',
  'fluency.weak_ending': 'awkward',
  'terminology.violation': 'terminology',
  'terminology.inconsistency': 'terminology',
  'consistency.phrase': 'terminology',
  'source.error': 'mistranslation',
  'source.ambiguity': 'mistranslation',
};

/** 통합 어휘를 앱 IssueType으로 변환한다(UI 표시용). */
export function fromUnifiedFindingType(type: UnifiedFindingType | string): IssueType {
  return UNIFIED_TO_ISSUE_TYPE[type as UnifiedFindingType] ?? 'awkward';
}

/**
 * severity는 앱과 장부가 동일 어휘(critical|major|minor)를 쓰므로 (§4.3),
 * 앱↔장부 변환은 항등이다. trans_agent의 🔴/🟡 변환은 에이전트 쪽 책임(§4.3).
 * 이 함수는 방어적 정규화용(알 수 없는 값은 major로).
 */
export function normalizeSeverity(severity: IssueSeverity | string): IssueSeverity {
  return severity === 'critical' || severity === 'major' || severity === 'minor'
    ? severity
    : 'major';
}
