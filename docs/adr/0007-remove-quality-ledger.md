# ADR-0007: 품질 장부를 제거한다

- **Status**: Accepted
- **Date**: 2026-07-29
- **관련**: `src-tauri/src/db/mod.rs:378` (`migrate_drop_quality_ledger`), 커밋 `21ffa38`

## Context

품질 장부(Quality Ledger)는 검수 제안의 proposed/accepted/rejected와 번역 실행 기록을 SQLite에 쌓는 기능이었습니다. 목적은 "AI 제안의 채택률을 측정해 프롬프트를 개선한다"였고, 후속 작업 WP-A2~A5가 그 분석을 담당할 예정이었습니다.

문제는 **쓰는 쪽이 끝내 만들어지지 않았다**는 것입니다. 남은 것:

- `quality_records` / `quality_runs` 테이블에 행은 계속 쌓임
- 읽는 코드 경로는 JSONL 내보내기 버튼 하나뿐 — 내보낸 파일을 분석하는 도구도 없음
- WP-A2~A5는 착수되지 않았고, 착수 근거(어떤 지표를 어떻게 볼 것인가)도 정해지지 않음

쓰지 않는 기록 코드가 검수 적용 경로(`ReviewPanel`, `EditorCanvasTipTap`)와 MCP 계약, 브리지에 얽혀 있었습니다. 즉 **읽히지 않는 데이터를 위해 핵심 경로가 복잡해져 있었습니다.**

대안으로 **기록은 두고 분석만 나중에**를 검토했습니다. 기각 — 그게 지금까지의 상태였고, 스키마와 호출 지점이 계속 유지 비용을 발생시키고 있었습니다. 필요해지면 그때 무엇을 재려는지 정하고 다시 넣는 편이 낫다고 판단했습니다.

## Decision

**전량 제거한다.** WP-A2~A5도 함께 폐기한다.

지운 것: `src/quality/` 모듈 전체, Rust `commands/quality.rs`와 db 메서드 5개, `QualityRecordRow`/`QualityRunRow`/`QualityRecordFilter`, `ReviewPanel`의 기록 호출과 JSONL 내보내기 버튼, `EditorCanvasTipTap`의 `logQualityRun` 2곳, `oddeyesAppBridge`의 브리지 메서드 2개, `review.ledger.*` i18n.

**테이블은 `migrate_drop_quality_ledger`로 DROP한다** — 코드만 지우면 죽은 스키마가 영구히 남습니다. `DROP TABLE IF EXISTS`라 재실행과 신규 DB 모두 안전합니다.

## Consequences

- **잃은 것 / 감수하는 것**: 그동안 쌓인 행이 마이그레이션과 함께 **사라집니다.** 되살리려면 스키마부터 다시 만들고 데이터를 처음부터 쌓아야 합니다. 이 결정은 사실상 비가역입니다.
- **계약 변경**: Desktop MCP 1.0.0 (breaking) — `oddeyes_log_quality_records` / `oddeyes_get_quality_records` 제거 (25 → 23 tools).
- **⚠️ 미완 상태**: `.mcpb` 재번들과 `npm publish`가 **아직 실시되지 않았습니다.** 배포 전까지 클라이언트에는 반영되지 않습니다.
- **남긴 것**: `src/tauri/dialog.ts`의 `pickQualityLedgerPath`는 정렬 리포트(`alignmentReport.ts`)가 아직 사용하므로 남겼습니다. 다이얼로그 제목이 `Export Quality Ledger`인 것은 이전부터 있던 부정확한 재사용이며, 이 결정의 범위 밖입니다.
- **되살리자는 제안이 올 때**: 먼저 "무엇을 측정해 어떤 결정을 내릴 것인가"를 정해야 합니다. 그게 없어서 폐기한 기능입니다.
