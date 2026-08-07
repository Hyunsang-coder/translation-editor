import {
  collectTranslationUnits,
  type TranslationUnit,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';

/**
 * 원문↔번역문 문단 정렬 (순수 함수, 영속화 없음)
 *
 * 이 저장소에는 지속적 정렬 레이어가 없다 — `project.segments`는 생성 시 2개에서
 * 늘지 않고(`addSegment` 호출부 0곳), `translationUnitId`는 두 에디터에서 독립
 * 발급된다. 그래서 정렬은 저장하지 않고 뷰를 열 때마다 여기서 계산하고, 짝이
 * 맞지 않는 구간은 고치지 않고 불일치로 표시한다.
 */

export type AlignOp =
  | { kind: 'pair'; source: TranslationUnit; target: TranslationUnit }
  | { kind: 'source-only'; source: TranslationUnit } // 1:0 — 번역 누락 의심
  | { kind: 'target-only'; target: TranslationUnit }; // 0:1 — 원문 없는 추가 의심

export interface AlignResult {
  ops: AlignOp[];
  pairedCount: number;
  /** source-only + target-only */
  mismatchCount: number;
  /** 빈 문단을 제외한 max(원문 유닛 수, 번역문 유닛 수) */
  totalUnits: number;
  /** pairedCount / totalUnits. 양쪽 다 비어 있으면 1 (어긋날 것이 없음) */
  ratio: number;
  /** LCS 상한을 넘어 순번 매칭으로 내려갔는지 — UI에서 "정렬 정확도 낮음" 표시 */
  degraded: boolean;
}

/** LCS는 O(n·m)이다. 이 곱을 넘으면 순번 매칭 폴백으로 내려간다. */
const LCS_CELL_LIMIT = 250_000;

/**
 * 매칭용 시그니처. **텍스트 내용은 쓰지 않는다** — 원문과 번역문은 언어가 달라
 * 내용 비교가 무의미하다. `path.length`로 리스트 항목·표 셀의 중첩 깊이를 구분하고,
 * heading은 레벨까지 넣어 h2↔h3 오매칭을 막는다.
 * (alignedCounterpartUnits가 degraded 순번 폴백 검증에도 쓴다)
 */
export function signature(unit: TranslationUnit): string {
  return `${unit.type}:${unit.path.length}:${unit.level ?? ''}`;
}

/**
 * 빈 문단은 정렬 대상에서 제외한다. 번역 과정에서 빈 문단 개수가 흔히 달라지므로,
 * 포함하면 정렬이 쉽게 깨진다.
 */
function contentUnits(doc: TranslationUnitDocument): TranslationUnit[] {
  return collectTranslationUnits(doc).filter((unit) => unit.text.trim().length > 0);
}

/** 순번 매칭 폴백 — min(n,m)까지 짝을 맞추고 나머지는 한쪽만 남긴다. */
function alignByOrder(source: TranslationUnit[], target: TranslationUnit[]): AlignOp[] {
  const ops: AlignOp[] = [];
  const paired = Math.min(source.length, target.length);

  for (let i = 0; i < paired; i += 1) {
    ops.push({ kind: 'pair', source: source[i]!, target: target[i]! });
  }
  for (let i = paired; i < source.length; i += 1) {
    ops.push({ kind: 'source-only', source: source[i]! });
  }
  for (let j = paired; j < target.length; j += 1) {
    ops.push({ kind: 'target-only', target: target[j]! });
  }

  return ops;
}

/** 시그니처 시퀀스의 최장 공통 부분수열을 구하고 백트래킹으로 연산 목록을 만든다. */
function alignByLcs(source: TranslationUnit[], target: TranslationUnit[]): AlignOp[] {
  const n = source.length;
  const m = target.length;
  const sourceSigs = source.map(signature);
  const targetSigs = target.map(signature);

  // (n+1) × (m+1) 평탄화 DP 테이블. dp[i][j] = dp[i * (m + 1) + j]
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i * width + j] =
        sourceSigs[i - 1] === targetSigs[j - 1]
          ? dp[(i - 1) * width + (j - 1)]! + 1
          : Math.max(dp[(i - 1) * width + j]!, dp[i * width + (j - 1)]!);
    }
  }

  // 뒤에서부터 되짚는다. 같은 자리에서 양쪽을 다 버려야 할 때는 target을 먼저
  // 처리해, 뒤집은 결과에서 source-only가 target-only보다 앞에 오게 한다
  // (좌:원문 / 우:번역문 2열 테이블의 읽기 순서와 맞춘다).
  const reversed: AlignOp[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sourceSigs[i - 1] === targetSigs[j - 1]) {
      reversed.push({ kind: 'pair', source: source[i - 1]!, target: target[j - 1]! });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i * width + (j - 1)]! >= dp[(i - 1) * width + j]!)) {
      reversed.push({ kind: 'target-only', target: target[j - 1]! });
      j -= 1;
    } else {
      reversed.push({ kind: 'source-only', source: source[i - 1]! });
      i -= 1;
    }
  }

  return reversed.reverse();
}

export function alignUnits(
  sourceDoc: TranslationUnitDocument,
  targetDoc: TranslationUnitDocument,
): AlignResult {
  const source = contentUnits(sourceDoc);
  const target = contentUnits(targetDoc);

  const degraded = source.length * target.length > LCS_CELL_LIMIT;
  const ops = degraded ? alignByOrder(source, target) : alignByLcs(source, target);

  const pairedCount = ops.reduce((count, op) => (op.kind === 'pair' ? count + 1 : count), 0);
  const totalUnits = Math.max(source.length, target.length);

  return {
    ops,
    pairedCount,
    mismatchCount: ops.length - pairedCount,
    totalUnits,
    ratio: totalUnits === 0 ? 1 : pairedCount / totalUnits,
    degraded,
  };
}
