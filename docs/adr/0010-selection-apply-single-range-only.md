# ADR-0010: 선택 영역 편집은 단일 범위에서만 적용하고, 그 밖의 선택은 참조 전용으로 둔다

- **Status**: Accepted
- **Date**: 2026-07-30
- **관련**: `61a38d1`, `8becda2`, `50e4a33`, `983ee3d`, `f8af463` / [ADR-0003](0003-no-auto-apply-preview-first.md)(Preview → Apply) / `docs/selection-editing-and-dynamic-context-plan.md` §7.4

## Context

선택 영역을 채팅에 넣으려면 `normalizeSelectionAnchorRange`를 통과해야 했고, 그 함수가 `$from.sameParent($to)`로 **한 문단 안**만 허용했다. 계획 문서 §7.4에 MVP 제약으로 명시된 항목이다. 증상은 두 가지였다.

- 문단을 가로질러 드래그하면 "한 문단 안의 텍스트만 선택해주세요."로 막힘. 표가 섞인 문서에서 특히 자주 걸린다.
- 표에서 여러 셀을 드래그하면 `CellSelection`이고 `selection.from/to`가 **head 셀 하나**만 가리켜서(문서 순서도 아님), 채팅은 막히고 코멘트·복사는 조용히 한 셀만 처리했다.

**제약**

- 채팅 컨텍스트 자체는 멀티블록에 이미 안전했다 — `ChatSelectionSnapshot`은 `from/to`를 담지 않고 `text` + `translationUnitIds`만 넘기며, 선택 도구는 처음부터 유닛 배열을 다룬다.
- 진짜로 막히는 곳은 적용 경로 하나다. `applySelectionEdit`은 범위를 `insertText`로 평문 하나로 치환하므로, 블록 경계를 넘으면 문단·리스트 항목·셀이 한 블록으로 뭉개진다.
- 앵커는 `removeSelectionAnchor`/`resolveSelectionAnchor` 호출부 22곳이 `anchorId` 단수를 전제한다.

**검토한 대안과 버린 이유**

1. **블록 스냅 + 유닛 단위 교체** — 선택을 블록 경계로 확장하고 유닛별로 N번 치환. 조각은 이미 다 있다(`translationUnitId`, `docBlockDiff`, `collectAlignedSourceUnits`). 버린 이유는 난이도가 아니라 **두 개의 미결 사항**이다. ① 모델이 N개 유닛을 정확히 N개로 돌려주는 비율을 모른다 — 어긋날 때 "적용 거부 / 앞에서부터 채우기(조용한 부분 적용) / 합치기(구조 뭉개짐)" 중 무엇이 맞는지는 그 숫자가 정한다. ② 부분 선택이 블록 전체로 반올림되므로 하이라이트 범위와 실제 수정 범위가 어긋난다 — 사용자가 납득해야 하는 동작 변경이다. 측정 없이 정하면 되돌리기 비싸다.
2. **앵커를 버리고 `anchorId`를 optional로** — 참조 전용이니 앵커가 필요 없다는 발상. 22곳에 가드가 퍼지고, `EditorCanvasTipTap`의 `onTransaction`이 앵커 부재를 매 트랜잭션마다 `detached`로 뒤집어 칩이 즉시 경고색이 된다. 무엇보다 하이라이트를 잃는다 — `Decoration.inline`은 블록 경계를 넘어도 정상 렌더된다(실측 확인).
3. **다중 범위를 min/max span 하나로 합치기** — 3열 표에서 1·3열만 고르면 사이의 2열이 범위에 들어온다(실측 확인). 조용히 틀린 결과라 에러보다 나쁘다.
4. **단위 정의(`TRANSLATION_UNIT_TYPES`)에서 `tableCell` 제거** — 셀이 두 칸으로 세어지는 문제의 근본 수정. 그러나 `collectTranslationUnits`를 정렬 검사 뷰(`alignUnits.ts`)와 문서 조회 도구가 같이 쓰므로 정렬 짝 맞추기 결과가 함께 바뀐다. 회귀 위험이 이득을 넘는다.

## Decision

**앵커는 다중 범위를 담고, 적용은 단일 범위만 받는다.**

- `SelectionAnchorRecord.ranges: SelectionRange[]` (`src/editor/extensions/SelectionAnchor.ts`). 데코레이션·위치 매핑·stale 판정이 범위별로 돈다. `anchorId`는 단수를 유지해 호출부 22곳은 무변경.
- 범위 정규화는 `sameParent` 대신 **클램핑**한다 — 범위가 덮는 첫/마지막 textblock 내부로 좁힌다(`textblockSpan`). Cmd+A는 `AllSelection`이고 `from=0`의 부모가 doc 노드라, `sameParent`만 풀어도 막혔다.
- 앵커 텍스트는 블록 구분자 `'\n'`을 포함해 읽는다(`readAnchorText`/`readAnchorRangesText`). 구분자가 없으면 문단 병합이 텍스트를 바꾸지 않아(`One`+`Two` → `OneTwo`) 구조 변경을 stale로 못 잡는다. `SelectionContext.text`와 값이 일치하게 되어 proposal 검증이 구조적으로 옳아진다.
- 적용 경로는 `getSingleAnchorRange`가 null이면 거부한다(`src/editor/utils/applySelectionEdit.ts`). 재번역은 **생성 전에** 막고(`SelectionContext.spansMultipleBlocks`), `propose_selection_edit`은 도구 목록에서 뺀다(`src/stores/chatStore.ai.ts`).
- 멀티블록 선택 본문에만 4,000자 상한을 둔다(`EditorCanvasTipTap.MAX_MULTI_BLOCK_SELECTION_CHARS`). 단일 문단에 걸면 긴 문단의 재번역이 오늘보다 나빠진다.
- 표 셀 중복은 **선택 도구 레벨에서만** 지운다(`selectionTools.dropDuplicatedContainers`) — 조상 단위가 바로 뒤 자손 단위와 텍스트까지 같을 때만.

## Consequences

- **얻은 것**: 문단·리스트·표를 가로지르는 선택으로 질문할 수 있다. 하이라이트가 범위마다 그려진다. 코멘트·복사가 선택한 셀 전부를 처리한다(head 셀만 처리하던 기존 버그 해소). Source 선택에서도 `get_aligned_selection_context`로 번역문을 대조할 수 있다.
- **잃은 것 / 감수하는 것**: 멀티블록·다중 범위 선택은 재번역과 수정안 제안을 쓸 수 없다 — 툴바의 `재번역`을 눌러도 토스트로 거절된다. 셀 안에 문단이 여러 개면 중복 제거 규칙이 걸리지 않아 셀이 여전히 두 칸 이상을 차지한다. `documentTools`도 `unitIds` 경로에서 같은 중복을 갖는다(전체 조회는 마크다운 변환이라 무관).
- **따라오는 의무**: 적용 경로를 새로 만들 때는 `getSingleAnchorRange`로 단일 범위를 확인할 것 — `anchor.ranges[0]`을 바로 쓰면 표 셀 선택에서 한 셀만 덮어쓴다. 위 대안 1을 다시 검토하려면 **모델의 유닛 개수 일치율 측정이 선행 조건**이다.

## 개정 (2026-08-13): 표 셀에 한한 다중 범위 적용

**결정**: 모든 범위가 **한 표 안의 서로 다른 셀에 있는 단일 textblock**일 때는, 범위마다 독립적인 `replaceWith`를 **한 트랜잭션**으로 적용할 수 있다(`applySelectionEdits` / 게이트는 `canApplySelectionEdits`, `src/editor/utils/applySelectionEdit.ts`). 일반 문단을 가로지르는 `TextSelection`은 **여전히 거절한다**.

본문 원칙은 그대로다 — 금지되는 것은 "여러 블록을 평문 하나로 덮는 것"이지 "블록마다 따로 덮는 것"이 아니다. 위 대안 1의 미결 사항도 이 예외에는 걸리지 않는다: ① 개수는 모델이 정하지 않고 셀 마커 N개로 고정되며(못 읽으면 전부 버림, 부분 적용 없음), ② 표 셀 선택은 이미 셀 경계로 떨어져 하이라이트와 수정 범위가 어긋나지 않는다.

- 생성 게이트와 적용 게이트가 **같은 술어**를 쓴다. 어긋나면 재번역을 다 받아 놓고 적용에서만 실패한다.
- 치환은 **문서 뒤쪽 범위부터** — 앞을 먼저 바꾸면 길이 차이만큼 뒤 범위가 밀려 엉뚱한 셀을 덮는다.
- 서식은 **범위마다** 판정한다. 굵은 셀과 평문 셀을 함께 골랐다고 "서식이 섞였다"고 하면 평탄화에서 굵기가 사라진다(`selectionHasUniformFormatting`).
- N>1의 손편집은 열지 않는다 — 하나의 텍스트로 합쳐 편집하면 셀 경계가 무너진다.
- `propose_selection_edit`(채팅)은 이 예외를 아직 쓰지 않는다.

## 개정 2 (2026-08-13): 예외를 "서로 다른 textblock"으로 넓힌다

**결정**: 다중 범위 적용의 조건은 표 셀이 아니라 **"범위마다 textblock 하나씩, 서로 다른 textblock"**이다(`canApplySelectionEdits`). 표 셀은 그 조건의 한 사례일 뿐이다. 문단을 가로지르는 `TextSelection`도 **textblock 단위로 쪼개면**(`splitSelectionAnchorRanges`) 같은 경로로 적용된다.

개정 1을 표에 한정했던 것은 보수적 선택이었고, 실제로 정확성이 요구하는 조건은 위 두 가지뿐이다 — 범위마다 독립 `replaceWith`를 하므로 블록이 뭉개질 일이 없고, 같은 블록에 두 범위가 있으면 앞 치환이 뒤 범위를 민다.

**본문 대안 1의 두 미결 사항이 어떻게 풀렸는지**:

- **① 모델의 유닛 개수 일치율** — 측정하지 않고 **구조로 제거했다.** 개수는 모델이 정하지 않고 `SEGMENT_i` 마커 N개로 고정하며, 하나라도 못 읽으면 전부 폐기한다(부분 적용 없음). "어긋날 때 무엇이 맞는가"라는 질문 자체가 사라진다.
- **② 하이라이트와 수정 범위의 어긋남** — 대안 1이 상정한 **블록 스냅을 하지 않는다.** `splitSelectionAnchorRanges`는 블록 경계로 반올림하지 않고 드래그 지점을 그대로 유지한다(문단 중간에서 시작하면 그 지점이 첫 범위의 시작이다). 어긋남이 생기지 않는다.

**감수하는 것**: 블록마다 독립 생성이므로 모델이 **한 문단의 내용을 옆 문단으로 옮길 수 없다.** 표 셀에서는 옳은 제약이지만 산문에서는 더 나은 번역을 막을 수 있다. 문단을 가로지르는 드래그의 의도가 보통 "이 대목을 고쳐줘"라는 점을 생각하면 실질적 한계다. 그럼에도 오늘의 전면 거절보다 낫다고 판단했다.

**원문 짝이 없는 블록**은 거절하지 않고 `[No source]`로 표시해 기존 번역문만 다듬게 한다(모달에도 "원문 미확인" 배지). 전부 짝이 없으면 순수 폴리싱이 되므로 단일 경로와 같은 기준으로 막는다. 긴 선택에서 한 블록 때문에 통째로 거절되면 못 쓰는 기능이 되기 때문이다.

쪼개기는 **재번역 경로에서만** 켠다(`createChatSelection`의 `splitByBlock`). 채팅 참조·코멘트는 쪼갤 이유가 없어 기존 정규화를 그대로 쓴다.

## 개정 3 (2026-08-20): 사용자가 고른 블록만 적용한다

**결정**: 다중 범위 적용은 범위마다 `string | null`을 받는다 — `null`은 **그 범위를 건드리지 않는다**(`SelectionEditReplacement`). 미리보기 모달은 블록마다 체크박스를 주고, 고른 인덱스만 `onApply`로 넘긴다.

문서 전체 폴리싱은 처음부터 문장 단위 체크박스로 부분 적용이 됐는데(`SelectiveDiffList`), 선택 영역 폴리싱은 개정 2로 문단까지 넓어지고도 미리보기가 표 셀 시절 모양이라 전부 아니면 전무였다. 막아둔 결정이 아니라 따라오지 않은 UI다.

- **건너뛰기를 `''`로 표현할 수 없다** — 빈 문자열은 이미 "그 범위를 삭제"다. 세 번째 상태가 필요해서 `null`을 넣었다. 범위와 1:1은 유지된다(인덱스가 곧 범위).
- **검증은 실제로 교체하는 범위만 본다.** 고르지 않은 블록의 서식이 섞였다고, 또는 그 블록의 텍스트가 스냅샷과 달라졌다고 고른 블록의 적용까지 막을 이유가 없다. 금칙어 검사도 같은 기준이다(`applyCurrentSelectionEdit`).
- **고를 수 있는 것은 제안이 도착한 블록뿐이다.** 스트리밍 중에는 선택을 아예 열지 않고, 스트리밍이 끊겨 일부만 채워진 채 로딩이 풀린 경우(`generateSelectionEdit`의 catch는 `cells`를 비우지 않는다)에는 도착한 블록만 고를 수 있다. 빈 제안이 선택에 섞이면 **그 블록이 지워진다**(빈 문자열 = 삭제) — 적용 직전 매핑에서도 같은 기준으로 한 번 더 `null`로 떨어뜨린다.
- 개정 1의 "부분 적용 없음"은 **모델이 블록 마커를 못 맞췄을 때 앞에서부터 조용히 채우지 않는다**는 뜻이다. 사람이 고른 부분 적용과는 다른 이야기이며, 응답 파싱은 여전히 하나라도 비면 전부 버린다(`runSegments`).
