# 폴리싱 diff 띄어쓰기 오탐 버그 — 조사 결과 및 수정 계획

> 작성: 2026-07-08
> 상태: **수정 완료** (2026-07-08) — 옵션 A 변형 적용. 아래 "적용된 수정" 참조.
> 브랜치: main

## 적용된 수정 (2026-07-08)

`src/utils/docBlockDiff.ts`에 공백 규칙을 **비교용/표시용으로 분리**해 적용:

- `sentenceKey(text)` (신설): 비교 전용. 다중 공백 단일화 + **한글-한글 사이 공백 제거**
  ("기능 은"→"기능은"). 양쪽에 대칭 적용되므로 실제 표현 차이(매우≠정말)는 보존.
- `normalizeDisplay(text)` (신설): 표시 전용. 다중 공백만 단일화, 어절 공백은 보존해
  카드 표시가 렌더링과 일치.
- `buildSentenceParts`의 `flush()`: `diffSentences`(raw)로 나온 change 후보를,
  `sentenceKey(removed) === sentenceKey(added)`이면 **equal로 강등**(원본 텍스트 유지)해
  마크 경계 공백만 다른 오탐 unit을 제거.
- `addUnit`: 저장 텍스트에 `normalizeDisplay` 적용(기존 `.trim()`과 병행).

`diffSentences`는 raw 텍스트로 유지 → 부분 병합 재조립(`mergeNodes`) 계약과 hardBreak
swap 강등 로직은 그대로. 회귀 없음.

**검증**: `docBlockDiff.test.ts`에 오탐 방지 테스트 2건 추가. `npx tsc --noEmit` 통과,
`npm run test:run` 802 passed / 55 files. 연속 hardBreak 축소(§48-49)는 원인이 달라
별도 이슈로 미해결.

---

> (이하 조사 원본 기록)

## 증상 (사용자 보고)

에디터 패널의 **한국어 폴리싱 버튼**을 눌러 폴리싱하면, **일부 문장에서 렌더링(화면 표시)과 다르게 띄어쓰기가 붙어 있는 형태**로 diff에 나타나, 실제로는 필요 없는 "잘못된 수정 추천"이 뜬다.

## 근본 원인 (확정)

폴리싱 미리보기의 문장 단위 diff 파이프라인(`src/utils/docBlockDiff.ts`)이 **원본 텍스트와 폴리싱 결과를 서로 다른 직렬화 경로로 문자열화**하기 때문. 두 경로의 공백/줄바꿈 규칙이 마크(볼드·이탤릭·링크·코드·hardBreak) 경계에서 어긋나, `Diff.diffSentences`가 실제로는 안 바뀐 부분까지 "변경"으로 잡거나, 표시되는 원본 텍스트가 렌더링과 달라진다.

| | 원본 (`originalText`) | 폴리싱 결과 (`polishedText`) |
|---|---|---|
| 경로 | TipTap JSON → `extractBlockText` **직접 직렬화** | TipTap JSON → tiptap-markdown → LLM → `parseTranslationResponseToTipTap` → `extractBlockText` |
| 공백 규칙 | marks/attrs **완전 무시**, text 노드 그냥 이어붙임 | `normalizeMarkdownWhitespace` + `fixMisalignedBoldMarks` + markdown 왕복 |

**핵심**: diff 비교/표시에 쓰는 두 텍스트가 **같은 정규화를 거치지 않는다**. `blockKey`(`docBlockDiff.ts:80-81`)는 블록 *매칭* 단계에서만 `\s+ → ' '` 정규화를 하지만, 실제 *표시*되는 `originalText`/`polishedText`와 *문장 세분화*(`buildSentenceParts`)는 정규화되지 않은 raw 텍스트를 사용한다.

## 관련 코드 위치

| 파일 | 위치 | 역할 |
|---|---|---|
| `src/utils/docBlockDiff.ts` | `extractBlockText` (`:53-73`) | 원본 텍스트 직렬화 (marks 무시, text 이어붙임 / hardBreak·비-text inline 노드는 `\n` 경계 or 소실) |
| `src/utils/docBlockDiff.ts` | `blockKey` (`:80-81`) | 블록 *매칭*용 키만 `\s+→' '` 정규화 (표시/세분화엔 미적용) |
| `src/utils/docBlockDiff.ts` | `buildSentenceParts` (`:132-167`, 특히 `:190`의 `Diff.diffSentences`) | raw 텍스트로 문장 세분화 → 공백 어긋나면 오탐 |
| `src/utils/docBlockDiff.ts` | `addUnit` (`:115-129`) | `originalText`/`polishedText`를 `.trim()`만 하고 저장 |
| `src/utils/markdownConverter.ts` | `normalizeMarkdownWhitespace` (`:358-389`) | 폴리싱 *결과* 경로에만 적용되는 마크 경계 공백 정규화 (`* ** ~~ \``) |
| `src/utils/markdownConverter.ts` | `fixMisalignedBoldMarks` (`:404~`) | 볼드 경계 보정 (결과 경로에만) |
| `src/components/editor/SelectiveDiffList.tsx` | `Diff.diffWords` (`:78`), `whitespace-pre-wrap` (`:104,129`) | 단어 단위 하이라이트 표시 |

## 재현 (검증 완료)

임시 vitest로 실제 파이프라인 재현. **원본 문서 자체의 markdown round-trip은 안정적(오탐 없음)** — 즉 원본 표현은 정상. 오탐은 **LLM이 실제로 반환한 마크 주변 공백이 원본과 다를 때** 발생:

```
원본MD  : "이 **기능**은 매우 유용합니다. 두 번째 문장은 그대로 둡니다."
원본txt : "이 기능은 매우 유용합니다. ..."          ← 조사가 붙음(렌더링과 동일)
LLM 반환: "이 **기능** 은 정말 유용합니다. ..."       ← 볼드 뒤 공백 삽입(LLM 습관)
폴리싱txt: "이 기능 은 정말 유용합니다. ..."           ← "기능 은" 으로 벌어짐
→ diff unit 기존:"이 기능은 매우 유용합니다." 제안:"이 기능 은 정말 유용합니다."
```

사용자 증상("렌더링은 띄어져 있는데 추천은 붙음")은 이 현상의 **거울상** — 원본에서 마크 뒤에 공백이 있는데 정규화/LLM이 그 공백을 흡수·제거하는 방향. 근본 원인은 동일(두 경로 공백 규칙 비대칭).

### hardBreak 부가 확인
- `extractBlockText`는 `hardBreak`를 사이 텍스트가 있을 때 `\n` 하나로 만들지만, **연속 hardBreak(`A\n\nB`)를 `A\nB`로 축소**함(렌더링과 불일치). markdown 경로는 `\`(백슬래시)로 직렬화. hardBreak 포함 문단은 `isFlatTextBlock`이 false라 통째 swap으로 강등되어 `\n` 포함 원본이 그대로 표시됨(이 케이스는 "붙음"이 아니라 줄바꿈으로 보임 → 별개 이슈일 수 있음).

## 수정 방향 (미결정 — 사용자 선택 대기)

### 옵션 A: 최소 수정 (권장)
`docBlockDiff.ts`에서 `buildSentenceParts`에 넣기 전, 그리고 `addUnit` 저장 직전에 **원본·폴리싱 텍스트 양쪽에 동일한 공백 정규화**를 적용해 비대칭 제거.
- 공통 정규화 헬퍼(예: 마크 경계 공백 규칙을 텍스트 레벨에서 통일 + 다중 공백 단일화)를 만들어 두 입력에 대칭 적용.
- 표시용 `originalText`/`polishedText`도 렌더링 기준으로 통일.
- 장점: 범위 좁고 회귀 위험 낮음. 단점: 정규화 규칙을 두 곳(markdown/text)에서 유지해야 함.

### 옵션 B: 근본 수정
`extractBlockText`를 **렌더링과 동일한 직렬화**(TipTap `getText` 또는 markdown 경유)로 교체해 원본/결과 경로 자체를 일치.
- 장점: 근본적. 단점: 범위 넓고 회귀 위험(기존 `docBlockDiff.test.ts` 다수 영향), 부분 병합(`rebuildLeaf`) 로직과 상호작용 주의.

## 다음 세션 착수 순서 (제안)

1. `src/utils/docBlockDiff.test.ts` 현행 테스트 확인 (특히 `:69` "공백만 다른 문단은 unit 없다", `:266` hardBreak swap 강등).
2. 위 재현 케이스를 **실패하는 테스트로 추가** (TDD): 볼드/링크/이탤릭/코드 뒤 공백 비대칭 → unit이 잘못 생기거나 originalText가 렌더링과 다른지 검증.
3. 옵션 A로 공통 정규화 적용 → 테스트 통과.
4. `npx tsc --noEmit` + `npm run test:run` 회귀 확인.
5. 실제 앱(폴리싱 버튼)으로 육안 검증 (`/verify` 또는 수동).

## 검증 명령
```bash
npx tsc --noEmit
npm run test:run          # docBlockDiff.test.ts 포함 전체
```

## 참고
- 조사 시 임시 테스트 파일(`src/utils/__repro.test.ts`)을 만들어 재현 후 모두 삭제함. 작업 트리 clean.
- 관련 워크플로우 배경: CLAUDE.md "Target Polishing workflow (v2.6.0)", `src/ai/polishDocument.ts`, `src/components/editor/EditorCanvasTipTap.tsx`(`openPolishPreview`/`applyPolishDoc`).
