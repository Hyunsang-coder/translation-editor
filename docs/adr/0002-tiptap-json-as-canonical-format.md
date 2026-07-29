# ADR-0002: TipTap JSON을 문서 정본으로 삼는다

- **Status**: Accepted
- **Date**: 2026-01-22 (소급 기록 2026-07-29)
- **관련**: `src/utils/markdownConverter.ts`, `src-tauri/src/db/schema.rs`, `.claude/CLAUDE.md` Core Principles

## Context

원문/번역문 문서를 저장하고, AI에 넘기고, 되받아 문서에 반영해야 합니다. 저장 포맷 후보는 셋이었습니다.

- **HTML** — TipTap이 바로 뱉지만 파싱해 되돌릴 때 속성이 유실되고, 문단 단위 diff·부분 적용이 문자열 조작이 됩니다.
- **Markdown** — AI가 가장 잘 다루는 포맷. 그러나 손실 포맷입니다. 마크 중첩(`**_a_**`), hardBreak, 노드 속성이 왕복에서 보존되지 않습니다.
- **TipTap JSON** — 에디터의 내부 표현 그대로. 손실 없이 왕복하고 노드 트리라서 구조적 diff가 가능하지만, LLM에 그대로 넣기에는 토큰이 과하고 모델이 다루기도 나쁩니다.

핵심 긴장은 **저장에 좋은 포맷과 AI에 좋은 포맷이 다르다**는 점입니다. 하나를 골라 양쪽에 쓰면 어느 한쪽이 반드시 깨집니다.

## Decision

**TipTap JSON이 정본이다.** Markdown은 AI 호출 경계에서만 쓰는 파생 포맷으로 격하한다.

- 저장: `blocks.content`(`src-tauri/src/db/schema.rs:17`), 히스토리 스냅샷, 프로젝트 직렬화 모두 TipTap JSON
- diff·부분 병합: 노드 트리 기준 (`src/utils/docBlockDiff.ts` — `extractBlockText`, `mergeDocBySelection`)
- AI 경계: `tipTapJsonToMarkdownForTranslation` / `markdownToTipTapJsonForTranslation` (`src/utils/markdownConverter.ts:260,283`)에서만 변환
- 외부 포맷 반입: 진입점에서 즉시 TipTap JSON으로 변환 (`src/utils/adfToTipTap.ts`, `htmlToTipTapJson`)

**JSON을 우회해 문서 문자열을 직접 조작하지 않는다.** 이 금지가 이 결정의 실질이며, `.claude/CLAUDE.md`에 Core Principle로 못박혀 있습니다.

## Consequences

- **얻은 것**: 포맷 손실이 AI 호출 경계 한 곳에 갇힙니다. 문서 저장·히스토리·복원 경로에는 손실이 없습니다. 검수 적용과 부분 재번역이 문자열 치환이 아니라 노드 범위 교체로 가능해집니다 — `reviewApply.ts`의 블록 경계 가드가 성립하는 근거입니다.
- **잃은 것 / 감수하는 것**: Markdown 왕복 정규화 코드를 계속 유지해야 합니다 (`normalizeMarkdownWhitespace`, `fixMisalignedBoldMarks`, `detectMarkdownTruncation`). AI가 Markdown 구조를 흐트러뜨리면 그 비용은 전부 이 경계에서 치릅니다.
- **따라오는 의무**: 새 문서 소스(외부 포맷)를 붙일 때마다 → TipTap JSON 변환기를 먼저 만들어야 합니다. 편의를 위해 Markdown이나 HTML을 저장 경로에 흘리면 히스토리·diff가 조용히 어긋납니다.
