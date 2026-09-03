# Architecture Decision Records (ADR)

이 디렉터리는 되돌리기 비싼 결정을 한 건에 문서 한 장으로 남깁니다.
형식은 [Michael Nygard 포맷](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)을 따릅니다.

## 목록

| # | 제목 | 상태 | 결정일 |
|---|------|------|--------|
| [0001](0001-adopt-adr.md) | ADR을 도입한다 | Accepted (일부 조항 → 0016) | 2026-07-29 |
| [0002](0002-tiptap-json-as-canonical-format.md) | TipTap JSON을 문서 정본으로 삼는다 | Accepted | 2026-01-22 (소급) |
| [0003](0003-no-auto-apply-preview-first.md) | AI는 문서를 직접 수정하지 않는다 (Preview → Apply) | Accepted | 2026-01-22 (소급) |
| [0004](0004-approval-based-project-memory.md) | 자유 텍스트 projectContext를 승인 기반 Project Memory로 대체한다 | Accepted | 2026-07-24 (소급) |
| [0005](0005-fixed-context-snapshot-per-workflow.md) | 워크플로우는 시작 시점 ContextSnapshot을 고정한다 | Accepted | 2026-07-24 (소급) |
| [0006](0006-hard-delete-instead-of-archive.md) | 프로젝트 메모리는 보관하지 않고 삭제한다 | Accepted | 2026-07-28 (소급) |
| [0007](0007-remove-quality-ledger.md) | 품질 장부를 제거한다 | Accepted | 2026-07-29 (소급) |
| [0008](0008-alignment-computed-not-persisted.md) | 문단 정렬은 계산하고 저장하지 않는다 | Accepted | 2026-07-28 (소급) |
| [0009](0009-project-memory-import-by-copy.md) | 프로젝트 메모리 재사용은 공유 링크가 아닌 복사로 한다 | Accepted | 2026-07-29 (소급) |
| [0010](0010-selection-apply-single-range-only.md) | 선택 영역 편집은 단일 범위에서만 적용하고, 그 밖의 선택은 참조 전용으로 둔다 | Accepted | 2026-07-30 |
| [0011](0011-remove-notion-integration.md) | Notion 연동을 제거한다 | Accepted | 2026-07-30 |
| [0012](0012-provider-only-model-selection.md) | 모델 선택을 provider 하나로 줄이고, 용도별 모델·effort는 앱이 고정한다 | Accepted | 2026-07-30 |
| [0013](0013-remove-alignment-report.md) | 정렬 리포트를 제거하고, 영속 정렬은 계측 없이 보류한다 | Accepted | 2026-07-30 |
| [0014](0014-pin-to-question-chat-scroll.md) | 채팅 스크롤은 하단을 추종하지 않고 질문을 상단에 고정한다 | Accepted | 2026-07-30 |
| [0015](0015-confluence-tools-as-local-wrappers.md) | Confluence 도구는 MCP 서버 도구를 그대로 바인딩하지 않고 로컬 래퍼로 감싼다 | Accepted | 2026-07-30 |
| [0016](0016-no-changelog-in-agent-prompt.md) | CLAUDE.md에 변경 이력을 두지 않고, 내용의 종류로 문서를 나눈다 | Accepted | 2026-07-30 |
| [0017](0017-model-override-for-evaluation.md) | 용도별 모델을 직접 지정할 수 있게 한다 (평가 목적, ADR-0012 부분 수정) | Accepted | 2026-07-31 |
| [0018](0018-snapshot-kind-column.md) | 스냅샷 종류를 description이 아니라 kind 컬럼으로 판별한다 | Accepted | 2026-07-31 |
| [0019](0019-remove-long-conversation-notice.md) | 대화 길이 알림을 제거하고, 새 세션은 컴포저 메뉴로 노출한다 | Accepted | 2026-08-07 |
| [0020](0020-auto-target-language.md) | 타겟 언어 기본값을 '자동'으로 두고, 방향은 원문에서 해석한다 | Accepted | 2026-08-12 |
| [0021](0021-explicit-source-language.md) | 원문 언어도 명시 선택 가능하게 하고, 방향은 한 함수로 해석한다 | Accepted | 2026-08-26 |
| [0022](0022-revive-chat-review-tools.md) | 채팅의 문서 전체 검수 도구를 되살린다 | Accepted | 2026-09-03 |

> **(소급)** = 결정 당시에는 ADR이 없었고, ADR 도입(0001) 시점에 기록을 복원한 항목입니다.
> 결정일은 실제 결정 시점, 문서 작성일은 2026-07-29입니다.

## 언제 ADR을 쓰나

**쓴다** — 되돌리는 데 코드 이상이 드는 결정:

- 저장 스키마·데이터 모델 변경 (테이블 추가/삭제, CHECK 변경, 마이그레이션 동반)
- 외부 계약의 breaking change (Desktop MCP 도구 시그니처, bridge 메서드)
- 기능·모듈 폐기 (되살리려면 데이터부터 다시 쌓아야 하는 것)
- 두 개 이상의 합리적인 선택지 중 하나를 고르고 나머지를 버린 경우
- 지금 코드에 제약으로 남아 있고, 모르는 사람이 보면 "왜 이렇게 했지"가 나올 것

**안 쓴다**:

- 버그 수정, 리팩터링, 구현 세부 — 코드와 커밋 메시지로 충분
- 되돌리기 싼 결정 (파일 위치, 함수 이름, 스타일)
- 아직 안 정한 것 — 검토 중인 선택지는 `docs/*-plan.md`에

## 규칙

1. **불변(immutable)** — 한번 Accepted된 ADR의 본문은 고치지 않습니다. 결정이 뒤집히면 **새 ADR을 쓰고** 옛 문서의 Status를 `Superseded by ADR-XXXX`로 바꿉니다. 오타·링크 수정은 예외.
2. **번호는 4자리 순번**, 재사용하지 않습니다. 파일명은 `NNNN-english-kebab-slug.md`, 본문 제목은 한국어.
3. **결정과 함께 커밋** — 결정을 담은 PR에 ADR을 같이 넣습니다. 나중에 몰아 쓰면 이유가 이미 사라져 있습니다.
4. **결론이 아니라 힘(force)을 적는다** — "무엇을 골랐나"보다 "무엇을 버렸고 왜 버렸나"가 6개월 뒤에 쓸모 있습니다.
5. **한 장을 넘기지 않는다** — 길어지면 설계 문서를 따로 만들고 ADR에서 링크합니다.

## 새 ADR 쓰기

```bash
cp docs/adr/0000-template.md docs/adr/00NN-your-slug.md
```

작성 후 위 목록 표에 한 줄 추가합니다.
