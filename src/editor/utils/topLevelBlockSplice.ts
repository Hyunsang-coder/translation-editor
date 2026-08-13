import type { TipTapDocJson } from '@/utils/markdownConverter';

/**
 * 최상위 블록 배열의 얕은 조합 (순수 함수, 입력 불변).
 *
 * 부분 범위 AI 실행(이어서 번역 / 폴리시 범위)은 결과를 에디터에 "부분 적용"하지
 * 않는다 — 요청 시점 target 스냅샷에 결과를 JSON 수준에서 병합한 **완성본**을 만들어
 * 기존 전체 교체 경로로 넣는다. 그 병합을 담당하는 모듈이다.
 *
 * 인덱스 기반 병합이 안전한 근거는 호출부의 L2 리비전 가드다 — 요청 시점과 적용
 * 시점의 target 리비전이 같으면 스냅샷과 현재 문서가 동일하므로 인덱스가 밀리지 않는다.
 *
 * attrs(translationUnitId 포함)는 손대지 않는다. 블록 객체를 그대로 재사용한다.
 */

function topLevelBlocks(doc: TipTapDocJson): unknown[] {
  const content = doc.content;
  return Array.isArray(content) ? content : [];
}

/** base 뒤에 added의 최상위 블록을 이어 붙인다. doc 레벨 속성은 base의 것을 유지한다. */
export function appendTopLevelBlocks(base: TipTapDocJson, added: TipTapDocJson): TipTapDocJson {
  return {
    ...base,
    content: [...topLevelBlocks(base), ...topLevelBlocks(added)],
  };
}

/**
 * base의 [fromIndex, toIndex] 최상위 블록 구간을 replacement의 블록들로 치환한다.
 * 두 인덱스 모두 포함(inclusive)이다.
 *
 * 범위가 문서 밖이면 던진다 — slice는 범위를 조용히 잘라내므로, 잘못된 인덱스가
 * 들어오면 사용자 문서가 소리 없이 뭉개진 채 병합된다. 검증 불가는 차단이 원칙이다.
 */
export function replaceTopLevelBlockRange(
  base: TipTapDocJson,
  fromIndex: number,
  toIndex: number,
  replacement: TipTapDocJson,
): TipTapDocJson {
  const blocks = topLevelBlocks(base);
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < fromIndex ||
    toIndex >= blocks.length
  ) {
    throw new Error(
      `replaceTopLevelBlockRange: 범위가 문서 밖입니다 (from=${fromIndex}, to=${toIndex}, blocks=${blocks.length}).`,
    );
  }

  return {
    ...base,
    content: [
      ...blocks.slice(0, fromIndex),
      ...topLevelBlocks(replacement),
      ...blocks.slice(toIndex + 1),
    ],
  };
}
