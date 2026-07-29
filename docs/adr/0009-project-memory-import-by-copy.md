# ADR-0009: 프로젝트 메모리 재사용은 공유 링크가 아닌 복사로 한다

- **Status**: Accepted
- **Date**: 2026-07-29
- **관련**: `src-tauri/src/commands/project_memory.rs:169` (`import_project_memory_items`)

## Context

같은 제품·같은 팀의 프로젝트를 여러 개 만들면 Project Memory([ADR-0004](0004-approval-based-project-memory.md))의 상당 부분이 겹칩니다. 새 프로젝트마다 손으로 다시 쌓는 건 낭비입니다.

용어집은 이미 `setProjectGlossaries`로 **여러 프로젝트에 링크**할 수 있으므로, 메모리도 같은 방식이 자연스러워 보였습니다. 검토 결과 두 가지가 걸렸습니다:

- `project_memory_state.revision`이 **프로젝트 단위**입니다. 공유 세트 1건을 수정하면 링크된 모든 프로젝트의 revision을 bump해야 하고, revision은 컨텍스트 스냅샷([ADR-0005](0005-fixed-context-snapshot-per-workflow.md))의 동일성 판정에 쓰이므로 이 연쇄를 틀리면 조용히 낡은 컨텍스트가 재사용됩니다.
- Desktop MCP의 메모리 도구 6종이 **projectId 단수를 전제**합니다. 공유 세트를 도입하면 전부 breaking입니다.

즉 링크의 비용은 "기능 하나"가 아니라 revision 모델과 외부 계약 전체였습니다.

## Decision

**복사(가져오기)로 한다.** Settings의 `가져오기`가 원본 프로젝트를 고르고, 항목·금칙어를 체크해 현재 프로젝트로 복사한다. 실시간 동기화가 아니라 **스냅샷 복사**다 — 원본을 나중에 고쳐도 따라오지 않는다.

하류(ContextSnapshot·주입·MCP)는 무변경이고, 추가된 커맨드는 `import_project_memory_items` 하나다.

세부 규칙 — 각각 실제 함정을 피하기 위한 것:

- **`created_at`은 지금 시각으로 새로 찍는다.** 프로젝트 복제용 `copy_project_memory_data`는 원본 시각을 복사하지만, 가져오기가 그러면 목록(`created_at ASC`) 중간에 파묻히고 상한 동점 처리에서 "오래된 것"으로 먼저 잘린다
- **`source`는 `import`로 덮고**, 출처 세션·메시지 id는 버린다 (원본 프로젝트의 대화를 가리키므로)
- **금칙어는 복사가 아니라 upsert 의미로 넣는다.** 스키마에 `(project_id, term)` UNIQUE가 없고 중복 병합은 `upsert_forbidden_term`에만 있어서, 복사 루프를 그대로 쓰면 가져올 때마다 증식한다
- **중복 판정은 카테고리를 뺀 내용 해시만 본다** — `add_project_memory_item`의 `(category, hash)`와 다르다. Settings 수동 추가가 기본값 `general`로 굳어 있어, 원본에서 `domain`으로 분류된 같은 문장이 카테고리 기준으로는 중복으로 잡히지 않는다 (E2E에서 실제 재현)
- **항목별 체크박스는 필수다.** 통째로 가져오면 채팅 상한 12를 넘겨 새 프로젝트 고유 메모리가 digest에서 밀린다. 예상 활성 수가 상한을 넘으면 모달이 미리 알린다

## Consequences

- **얻은 것**: revision 모델과 MCP 계약을 건드리지 않고 재사용을 얻었습니다. 가져온 뒤 프로젝트마다 독립적으로 수정할 수 있습니다.
- **잃은 것 / 감수하는 것**: 원본을 고쳐도 전파되지 않습니다. 여러 프로젝트에 같은 규칙을 퍼뜨린 뒤 그 규칙이 틀렸음을 알면, 프로젝트마다 손으로 고쳐야 합니다. 공통 지식을 한 곳에서 관리하려는 요구가 커지면 이 결정을 다시 봐야 합니다.
- **범위 밖**: 용어집은 이미 링크가 가능하므로 이 결정의 대상이 아닙니다.
