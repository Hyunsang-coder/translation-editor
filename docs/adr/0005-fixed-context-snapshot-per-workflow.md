# ADR-0005: 워크플로우는 시작 시점 ContextSnapshot을 고정한다

- **Status**: Accepted
- **Date**: 2026-07-24 (소급 기록 2026-07-29)
- **관련**: `src/ai/context/buildContextSnapshot.ts`, `src/ai/context/resolveWorkflowContext.ts`, `src/types/index.ts:300`

## Context

전체 번역·검수·폴리싱·부분 재번역은 모두 용어집, Project Memory, 금칙어, 번역 규칙을 참조합니다. 검수는 문서를 여러 chunk로 쪼개 순차 실행하므로 한 작업이 수 분간 이어집니다.

그 사이 사용자가 용어집을 고치거나 채팅에서 메모리 제안을 승인하면, **chunk마다 다른 컨텍스트로 실행**됩니다. 결과는 한 문서 안에서 앞뒤 chunk의 용어 처리가 달라지는 것 — 즉 일관성 검수 도구가 스스로 비일관성을 만듭니다. 게다가 "이 검수 결과가 무엇을 참조해 나왔는지"를 사후에 재현할 수 없습니다.

대안:

- **컨텍스트 변경 시 작업을 중단하고 재시작** — 사용자가 채팅에서 뭔가 승인할 때마다 진행 중인 검수가 날아갑니다. 기각.
- **매 chunk마다 최신 값을 읽되 변경을 UI에 알림** — 일관성 문제가 그대로 남습니다. 기각.

## Decision

**작업 시작 시점에 컨텍스트를 스냅샷으로 고정하고, 그 작업의 모든 chunk가 같은 revision을 공유한다.**

- `buildContextSnapshot`(`src/ai/context/buildContextSnapshot.ts:19`)이 시작 시 스냅샷을 만든다. 스냅샷에는 **전체**를 담는다 — 스냅샷은 "그 시점의 상태"라는 의미이므로 여기서 자르지 않는다
- `resolveWorkflowContextFromSnapshot`(`src/ai/context/resolveWorkflowContext.ts:35`)이 주입 직전에 mode별 상한을 적용한다 (전체 번역/검수/폴리싱 40, 부분 재번역 20)
- `ContextManifest`가 실제 주입된 참조 ID·도구·토큰을 UI에 표시한다. `manifest.projectMemoryItemIds`는 스냅샷 전체가 아니라 **실제 주입분**과 일치시킨다
- 작업 중 사용자가 지식을 고쳐도 진행 중인 작업에는 반영되지 않는다. 다음 작업부터 적용된다

## Consequences

- **얻은 것**: 한 작업의 결과가 단일 컨텍스트에서 나옵니다. Manifest 덕에 "이 검수는 무엇을 보고 나왔나"에 답할 수 있고, revision이 같으므로 재현도 가능합니다.
- **잃은 것 / 감수하는 것**: 긴 작업 중에 지식을 고쳐도 즉시 반영되지 않습니다. 이것은 버그가 아니라 의도이지만, 사용자에게는 "방금 승인했는데 왜 안 먹지"로 보입니다.
- **구조적 함정**: 스냅샷은 전체를 담고 주입은 상한을 걸므로 **둘은 항상 불일치합니다.** manifest가 그 간극을 흡수하는 유일한 지점이며, 상한 로직을 고치면서 manifest를 같이 안 고치면 UI가 조용히 거짓 보고를 시작합니다.
- **하지 않기로 한 것**: 카테고리 기준 하드 제외는 넣지 않습니다 — legacy 마이그레이션분과 Settings 수동 추가분이 모두 `general`이라 배제하면 데이터가 통째로 누락됩니다.
