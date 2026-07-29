# ADR-0006: 프로젝트 메모리는 보관하지 않고 삭제한다

- **Status**: Accepted
- **Date**: 2026-07-28
- **관련**: `src-tauri/src/db/mod.rs:391` (`migrate_drop_project_memory_archive`), `src-tauri/src/commands/project_memory.rs:146`

## Context

[ADR-0004](0004-approval-based-project-memory.md)의 초기 설계에는 `status='archived'`와 `supersedes_id`가 있었습니다. 항목을 지우는 대신 보관하고, 편집하면 원본을 archive한 뒤 새 행을 넣어 이력을 남기는 구조였습니다.

실제로 쓰이면서 드러난 것:

- archived 항목은 AI 주입에서 **이미 제외**됩니다. 즉 기능적으로는 삭제와 같습니다.
- 그런데 목록에는 영구히 남고, 되돌릴 UI가 없었습니다. 사용자 입장에서는 **치울 수 없는 시체**입니다.
- 편집할 때마다 행이 늘어납니다. `supersedes_id` 체인으로 이력을 볼 UI도 없었으므로, 늘어난 행은 아무도 읽지 않는 데이터였습니다.

즉 이력 보존이라는 명목의 비용만 있고 그 이력을 소비하는 곳이 없었습니다.

## Decision

**보관 개념을 제거하고 하드 삭제 하나로 통일한다.**

- 스키마: `project_memory_items`에서 `supersedes_id` 컬럼 제거, `status` CHECK를 `('proposed','active')`로 축소
- 마이그레이션: `migrate_drop_project_memory_archive`가 테이블을 재구성하며 archived 행을 삭제한다. **`supersedes_id` 컬럼 유무로 실행 여부를 판정**하므로 재실행에 안전하다
- 편집은 제자리 UPDATE — `replace_project_memory_item`이 archive + insert 대신 UPDATE만 한다. `id`와 `created_at`이 유지되고 행이 늘지 않는다
- 삭제 커맨드 `delete_project_memory_item` 신설. UI는 `편집 / 삭제` 두 버튼 (네이티브 confirm 경유)
- 채팅 제안의 `operation`은 `add|replace|delete`. 저장된 legacy `'archive'` 값은 `knowledgeProposals.ts`의 `normalizeOperation`이 **읽기 시점에** `delete`로 정규화한다 (DB를 건드리지 않음)

## Consequences

- **얻은 것**: 목록이 사용자가 통제하는 상태만 보여줍니다. 편집해도 행이 늘지 않아 상한 계산이 예측 가능해집니다.
- **잃은 것 / 감수하는 것**: 실수로 지운 항목을 되돌릴 방법이 없습니다. 프로젝트 히스토리 스냅샷은 문서만 담으므로 메모리 복구에 쓸 수 없습니다. 삭제 전 confirm이 유일한 방어선입니다.
- **계약 변경**: Desktop MCP 0.9.0 (breaking) — `oddeyes_archive_project_memory_item` → `oddeyes_delete_project_memory_item`, `list`의 status enum에서 `archived` 제거, `replace` 응답에서 `archived` 필드 제거.
- **따라오는 의무**: `load_project_memory`는 status로 필터하지 않습니다(`db/mod.rs`). 따라서 **UI에서 편집·삭제 버튼을 status로 가리면 안 됩니다** — 언젠가 목록에는 보이는데 지울 수 없는 항목이 생기고, 그건 이 ADR이 없앤 문제가 그대로 돌아온 것입니다.
