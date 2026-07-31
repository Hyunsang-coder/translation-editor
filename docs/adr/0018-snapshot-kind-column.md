# ADR-0018: 스냅샷 종류를 description이 아니라 kind 컬럼으로 판별한다

- **Status**: Accepted
- **Date**: 2026-07-31
- **관련**: `src-tauri/src/db/mod.rs:migrate_history_kind`, 스냅샷 로직 코드 조사(2026-07-31)

## Context

`upsert_auto_snapshot`은 자동 저장 슬롯을 이렇게 찾고 있었다:

```sql
WHERE description = 'autoSnapshot' OR description LIKE '자동 저장%'
```

`description`은 히스토리 rename 다이얼로그로 사용자가 아무 문자열이나 넣을 수 있는 **표시용
필드**다. 여기에 종류라는 의미를 실으면서 두 가지가 깨졌다.

- **문제 1 — 조용한 유실.** 수동 스냅샷 이름을 "자동 저장 백업"으로 바꾸면 그 스냅샷은
  타임라인 필터(`HistoryDrawer`)에서 사라지고, 동시에 다음 auto tick의 **덮어쓰기 대상**이 된다.
  사용자가 이름을 붙여 남긴 체크포인트가 3초 뒤 자동 저장 내용으로 대체된다.
- **문제 2 — i18n 지뢰.** 판별 문자열이 한국어 리터럴인데 `en.json`에는 이미
  `history.autoSnapshotLabel: "Auto save"`가 있다. 라벨을 i18n하는 순간(그게 자연스러운 다음
  수순이다) `LIKE`가 안 맞아 매 tick마다 새 행이 INSERT되고, 50개 FIFO 보존 한도가 수동
  스냅샷을 전부 밀어낸다.

**제약**: 기존 사용자 DB에는 두 세대의 auto 행(`'autoSnapshot'`과 `'자동 저장 …'`)이 섞여 있을
수 있다. upsert가 `ORDER BY timestamp DESC LIMIT 1`로 최신 1개만 갱신해 왔으므로, 오래된 쪽은
타임라인에 보이지도 복원되지도 않는 **고아 스냅샷**으로 남아 있다.

### 검토한 대안과 버린 이유

- **rename에서 예약 접두사를 금지한다** — "이 이름은 쓸 수 없습니다"를 사용자에게 설명해야 하고,
  지원 언어가 늘 때마다 예약어가 늘어난다. 표시 문자열에 로직을 계속 싣는다는 근본 문제가 그대로다.
- **슬롯 참조를 history 밖(프로젝트 테이블의 `auto_snapshot_id` 등)에 둔다** — 스냅샷 삭제·CASCADE와
  동기화해야 할 상태가 새로 생긴다. 종류는 행 자체의 속성이므로 행에 두는 편이 맞다.
- **고아 auto 행을 삭제한다** — 유니크 인덱스를 만들려면 중복 정리가 선행돼야 하는데, 삭제는 사용자
  데이터를 없애는 것이다. 그 행들은 UI에 안 보였을 뿐 온전히 복원 가능한 스냅샷이다.
- **컬럼만 추가하고 유니크 인덱스는 만들지 않는다** — "프로젝트당 auto 1개"는 프런트·백엔드 코드가
  이미 전제하는 불변식이다. 규약으로만 두면 오늘 같은 고아가 또 쌓이고, 그때도 아무도 모른다.

## Decision

**종류 판별은 `history.kind` 컬럼으로만 한다.** description은 표시 전용으로 되돌린다.

- 스키마(`src-tauri/src/db/schema.rs`):
  `kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'auto'))`
- 불변식은 DB가 강제한다:
  `CREATE UNIQUE INDEX idx_history_one_auto_per_project ON history(project_id) WHERE kind = 'auto'`
  이 인덱스는 `CREATE_SCHEMA`가 아니라 `Database::migrate_history_kind`에서 만든다 — `CREATE_SCHEMA`는
  기존 DB에서도 매 기동 먼저 실행되는데 그 시점엔 `kind` 컬럼이 아직 없다.
- 마이그레이션(`src-tauri/src/db/mod.rs:migrate_history_kind`):
  1. 컬럼을 추가할 때 **단 한 번** 레거시 description으로 backfill한다. `snapshot_json IS NULL`인
     행은 제외한다 — 목록·복원에서 이미 걸러지는 행이라, auto로 올리면 upsert가 되살릴 수 없는
     빈 슬롯을 차지한다.
  2. 프로젝트당 가장 최신 auto 1개만 남기고 나머지는 `manual`로 **강등**한다(삭제하지 않는다).
  3. 유니크 인덱스를 만든다. 2·3은 재실행에 안전해서, 인덱스 생성이 실패했던 DB도 다음 기동에
     스스로 복구한다.
- 프런트엔드는 `HistorySnapshotMeta.kind`로 필터한다(`HistoryDrawer.tsx`, `historyStore.ts`).
  자동 저장 description은 `history.autoSnapshotLabel` i18n을 쓴다 — 이제 표시 문자열이 로직에
  영향을 주지 않으므로 안전하다.

## Consequences

- **얻은 것**: rename이 스냅샷의 종류를 바꾸지 못한다. 자동 저장 라벨을 i18n해도 저장 로직이
  깨지지 않는다. 그동안 보이지도 복원되지도 않던 고아 auto 행이 타임라인에 드러난다.
- **잃은 것 / 감수하는 것**: 마이그레이션이 강등한 고아 행이 사용자 눈에 갑자기 나타난다(대개
  프로젝트당 0~1개). 그만큼 50개 보존 한도를 먼저 소모한다.
- **따라오는 의무**:
  - **backfill은 `if !has_kind` 블록 안에서만 실행한다.** 매 기동 실행하면 rename된 수동
    스냅샷이 다시 auto로 승격되어, 이 ADR이 고친 유실 버그가 그대로 돌아온다.
  - 새 스냅샷 저장 경로를 추가하면 INSERT에 `kind`를 명시한다. 기본값이 `'manual'`이므로 자동
    슬롯은 반드시 `'auto'`를 써야 한다.
  - `history`에 새 인덱스를 추가할 때, 마이그레이션으로 들어온 컬럼을 참조한다면 `CREATE_SCHEMA`가
    아니라 `run_migrations`에 둔다.
