# ADR-0004: 자유 텍스트 projectContext를 승인 기반 Project Memory로 대체한다

- **Status**: Accepted
- **Date**: 2026-07-24 (MCP 계약 정리 2026-07-27, 소급 기록 2026-07-29)
- **관련**: `src-tauri/src/commands/project_memory.rs`, `src/ai/context/projectMemoryPolicy.ts`, `docs/dynamic-project-knowledge-fix-plan.md`

## Context

프로젝트별 배경지식은 원래 `projectContext`라는 **자유 텍스트 한 덩어리**였습니다. Settings에서 편집하고, 통째로 시스템 프롬프트에 붙였습니다. 규모가 커지면서 세 가지가 동시에 깨졌습니다.

- **출처를 모른다** — 누가 언제 왜 넣은 문장인지 알 수 없어, 낡은 지시가 들어 있어도 지울 근거가 없습니다.
- **상한을 걸 수 없다** — 한 덩어리라 자르면 문장 중간에서 끊깁니다. 결과적으로 전량 주입뿐이고, 길어질수록 매 요청의 토큰을 잠식합니다.
- **무엇이 반영됐는지 확인할 수 없다** — 사용자는 자기가 쓴 지시가 실제로 AI에 갔는지 알 방법이 없습니다.

대안으로 **텍스트를 유지하되 길이 제한만 거는 안**을 검토했습니다. 상한 초과 시 무엇이 잘릴지 사용자가 통제할 수 없어 기각했습니다 — 문제는 길이가 아니라 항목 단위가 없다는 것이었습니다.

## Decision

지식을 **항목 단위로 쪼개고, 상태·출처·카테고리를 붙이고, 승인을 거쳐야 활성화되게 한다.**

- 저장: `project_memory_items` 테이블 (`status`, `source`, `category`, 내용 해시). 금칙어는 `forbidden_terms`로 분리
- 승인: 채팅이 제안하면 `proposed`, 사용자가 승인해야 `active` ([ADR-0003](0003-no-auto-apply-preview-first.md)의 원칙을 지식 경로에 적용). 외부 반입(MCP)은 `source='import'` + `active`로 즉시 반영하되 Settings에서 출처 확인·삭제 가능
- 주입: 채팅은 **push + pull 혼합** — 압축 요약을 시스템 프롬프트에 push(`renderChatMemoryDigest`, 12개·1500자)하고 상세는 `get_project_guidance` 도구로 pull. 워크플로우는 mode별 상한(전체 번역/검수/폴리싱 40, 부분 재번역 20)
- 선별 우선순위: `source === 'user'`를 카테고리보다 먼저 본다 (`src/ai/context/projectMemoryPolicy.ts`) — 손으로 친 항목이 채팅 제안분보다 먼저 잘리던 역전을 막기 위함
- 채팅 경로의 legacy `projectContext` 주입은 제거. Desktop MCP에서도 파라미터 제거(0.8.0, breaking)

## Consequences

- **얻은 것**: 무엇이 주입됐는지 셀 수 있고 화면에 표시됩니다(`채팅 12/14`). 낡은 항목을 근거를 갖고 지울 수 있습니다. 상한이 항목 경계에서 걸리므로 잘려도 문장이 깨지지 않습니다.
- **잃은 것 / 감수하는 것**: 사용자가 "그냥 길게 쓰기"를 못 합니다 — 항목으로 쪼개는 부담이 생겼습니다. 그리고 legacy 호환 코드를 계속 들고 있습니다: `projectMemoryStore.hydrate`의 `legacyProjectContext` 마이그레이션, 워크플로우의 메모리 0건일 때 fallback, DB 필드와 store 세터.
- **함정**: `reviewTool.ts` / `translateDocument.ts` / `polishDocument.ts`에 있는 `projectContext` 파라미터는 **이것과 다른 값**입니다 — 워크플로우 `resolvedContext`에서 옵니다. 이름이 같아 혼동하기 쉽습니다.
- **따라오는 의무**: 주입 상한이 mode마다 다르므로(채팅 12, 워크플로우 40/20), 어떤 항목이 "주입 안 됨"이라고 UI에서 단정하면 거짓말이 됩니다. 상한 계산은 개수만 세지 말고 렌더러(`renderChatMemoryDigest`)에게 물어야 합니다 — 문자 예산에서도 잘리기 때문입니다.
