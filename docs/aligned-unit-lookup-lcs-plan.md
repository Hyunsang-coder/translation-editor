# 원문↔번역문 유닛 대응을 LCS 정렬로 교체 (작업 계획)

작성: 2026-08-07 / 상태: **미착수**

> 증상: 번역 이력이 없는 문서에서 **원문에 문단을 하나 추가·분할하면 문서 전체의 선택 재번역이
> "연결된 원문을 찾을 수 없습니다"로 죽는다.** 편집한 문단만이 아니라 전부.

---

## 1. 무엇이 문제인가

`collectAlignedSourceUnits`(`src/editor/extensions/TranslationUnitId.ts:166`)는 두 단계로 동작한다.

1. **ID 직접 매칭** — 전체 번역·폴리싱을 적용하면 `reattachTranslationUnitIds`가 Source의
   `translationUnitId`를 Target에 이식한다. 이 문서는 원문을 어떻게 편집해도 안전하다.
2. **순번 fallback** (`:185-207`) — ID가 하나도 안 맞는 문서(손번역, 예전 프로젝트)용.
   **빈 문단을 뺀 내용 유닛 수가 양쪽 정확히 같고** 각 순번의 타입·중첩 깊이·heading 레벨이
   일치할 때만 같은 순번끼리 대응시킨다.

문제는 2번의 **"개수가 정확히 같아야 한다"**(`:191`)다. 원문에 문단이 하나 늘거나 줄면 조건이
깨지고, 그러면 **선택한 문단이 아니라 문서의 모든 문단**이 원문을 잃는다.

### 재현 결과 (2026-08-07 확인)

| 상황 | 결과 |
|---|---|
| 오타만 수정 (문단 개수 유지) | 정상 |
| 원문에 빈 문단만 추가 | 정상 (빈 유닛은 세지 않음) |
| 재부착 문서 + 원문 문단 추가·분할 | 정상 (ID 직접 매칭) |
| **legacy 문서 + 원문 문단 추가** | **실패** |
| **legacy 문서 + 원문 문단 분할** | **실패** |

## 2. 왜 직전 수정(2b101ed)으로 안 잡혔나

2b101ed는 73627e8이 fallback을 opt-in으로 바꿔놓고 켜는 호출부를 안 만든 회귀를 복구했다.
fallback을 되살렸을 뿐, **fallback 자체의 전체 1:1 요구는 그대로 물려받았다.**

그때 "정렬 검사(alignUnits)와 같은 기준이라 정렬 뷰가 일치라고 하면 재번역도 된다"고
기록했는데 **정확하지 않다.** 문단 하나하나를 비교하는 시그니처는 같게 맞췄지만, 재번역에는
정렬 뷰에 없는 "문서 전체가 완벽히 1:1" 조건이 추가로 붙어 있다. 정렬 뷰가
"20개 중 19개 짝지음"으로 보여주는 문서에서 재번역은 20개 전부 실패한다.

## 3. 어떻게 고치나

정렬 뷰가 쓰는 **LCS 정렬(`src/utils/alignUnits.ts`)을 재번역에서도 쓴다.** LCS는 문단이
추가·삭제돼도 나머지를 정확히 짝짓고 짝 없는 것만 `source-only`/`target-only`로 남긴다.
선택한 Target 유닛이 `pair` op에 들어 있으면 그 Source를 쓰고, 아니면 그때만 실패시킨다.

이러면 "원문 한 군데 고쳤다고 문서 전체가 죽는" 동작이 사라지고, 위 2절에서 틀렸던
"정렬 뷰와 재번역의 판단이 같다"가 비로소 실제로 성립한다. 검증된 기존 코드 재사용이라
새 알고리즘도 필요 없다.

### 구조 제약: 순환 참조

`alignUnits.ts`가 이미 `TranslationUnitId.ts`에서 `collectTranslationUnits`를 가져온다.
반대로 `TranslationUnitId.ts`가 `alignUnits`를 값으로 가져오면 런타임 순환이 된다.

→ **둘을 조합하는 얇은 모듈을 새로 만든다.** 예: `src/editor/utils/alignedCounterpartUnits.ts`

```
TranslationUnitId.ts   (유닛 수집·ID 원시 기능)
alignUnits.ts          (LCS 정렬 알고리즘)
        ↓ 둘 다 import
alignedCounterpartUnits.ts   (정책: ID 매칭 → 실패 시 LCS 짝짓기)
```

공개 함수(안): 방향 무관하게 쓸 수 있어야 한다 — 채팅은 Source 선택도 지원하고,
검수는 Source→Target 역방향으로 쓴다.

```ts
export function findAlignedCounterpartUnits(
  counterpartDoc: TranslationUnitDocument,  // 찾고 싶은 쪽
  primaryDoc: TranslationUnitDocument,      // 선택이 있는 쪽
  selectedUnitIds: string[],
): TranslationUnit[]
```

### 유지해야 할 성질 (되돌리지 말 것)

73627e8의 안전 의도와 2b101ed에서 확인된 것들:

- **부분 매칭에 부분 원문을 돌려주지 않는다.** 선택 ID 일부만 대응되면 빈 배열.
  (선택의 나머지가 조용히 빠지는 것보다 중단이 낫다.)
- **고유 ID 수로 판정한다.** 문단 중간 분할·붙여넣기로 같은 `translationUnitId`가 여러
  유닛에 복제될 수 있다(TipTap `splitBlock`이 attrs를 통째로 복사, `keepOnSplit: false`로도
  중간 분할은 못 막음). 유닛 개수로 세면 이 문서들이 깨진다.
- **짝을 못 찾으면 추측하지 않는다.** LCS가 `pair`로 묶지 못한 유닛은 실패시킨다.

## 4. 손댈 곳

| 파일 | 위치 | 할 일 |
|---|---|---|
| `src/editor/utils/alignedCounterpartUnits.ts` | 신규 | ID 매칭 + LCS 짝짓기 |
| `src/components/editor/EditorCanvasTipTap.tsx` | `:617` | 선택 재번역 — 새 함수로 교체 |
| `src/ai/tools/selectionTools.ts` | `:155` | 채팅 선택 컨텍스트 — 새 함수로 교체 |
| `src/components/review/reviewApply.ts` | `:397` | 검수 위치 힌트(Source→Target) — 새 함수로 교체 |
| `src/editor/extensions/TranslationUnitId.ts` | `:166-207` | 호출부가 없어지면 `collectAlignedSourceUnits`와 `allowLegacyOrderFallback` 제거 |

`selectionTools.ts:163-177`의 대응 개수 검사(고유 ID 수 비교 + 빈 유닛 제외 비교)는
LCS로 바꾸면 단순해질 수 있다. 다만 빈 문단이 문맥 창에 끼는 케이스를 깨지 말 것 —
회귀 테스트가 `selectionTools.test.ts`에 있다.

## 5. 테스트

기존 회귀 테스트를 깨지 않는 것이 우선이다. 특히:

- `src/editor/extensions/TranslationUnitId.test.ts` — 중복 ID, 부분 매칭, heading 레벨
- `src/ai/tools/selectionTools.test.ts` — legacy 문단 짝짓기, 빈 문단 낀 문맥 창, Target 중복 ID
- `src/components/review/reviewApply.test.ts` — 유닛 정렬 위치 힌트

새로 추가할 것:

- legacy 문서 + 원문에 문단 **추가** → 나머지 문단은 정상 짝짓기 (지금 실패하는 케이스)
- legacy 문서 + 원문 문단 **분할** → 나머지 문단은 정상 짝짓기
- 추가된 문단 자체를 선택 → 짝이 없으므로 실패 (추측 금지)
- 문단 순서가 뒤바뀐 문서 → LCS가 잘못 짝짓지 않는지 확인

## 6. 검증

```bash
npx tsc --noEmit
npm run test:run
```

실기기 확인이 필요하면 `npm run install:local`로 설치본을 교체해서 테스트한다.

## 7. 참고

- 직전 수정: `2b101ed` (재번역 회귀 복구), `526e9f1` (검수 위치 힌트)
- 회귀를 만든 커밋: `73627e8`
- 관련 문서: `docs/selection-editing-and-dynamic-context-plan.md`
