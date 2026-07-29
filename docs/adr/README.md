# Architecture Decision Records (ADR)

이 디렉터리는 되돌리기 비싼 결정을 한 건에 문서 한 장으로 남깁니다.
형식은 [Michael Nygard 포맷](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)을 따릅니다.

## 목록

| # | 제목 | 상태 | 결정일 |
|---|------|------|--------|
| [0001](0001-adopt-adr.md) | ADR을 도입한다 | Accepted | 2026-07-29 |
| [0002](0002-tiptap-json-as-canonical-format.md) | TipTap JSON을 문서 정본으로 삼는다 | Accepted | 2026-01-22 (소급) |
| [0003](0003-no-auto-apply-preview-first.md) | AI는 문서를 직접 수정하지 않는다 (Preview → Apply) | Accepted | 2026-01-22 (소급) |
| [0004](0004-approval-based-project-memory.md) | 자유 텍스트 projectContext를 승인 기반 Project Memory로 대체한다 | Accepted | 2026-07-24 (소급) |
| [0005](0005-fixed-context-snapshot-per-workflow.md) | 워크플로우는 시작 시점 ContextSnapshot을 고정한다 | Accepted | 2026-07-24 (소급) |
| [0006](0006-hard-delete-instead-of-archive.md) | 프로젝트 메모리는 보관하지 않고 삭제한다 | Accepted | 2026-07-28 (소급) |
| [0007](0007-remove-quality-ledger.md) | 품질 장부를 제거한다 | Accepted | 2026-07-29 (소급) |
| [0008](0008-alignment-computed-not-persisted.md) | 문단 정렬은 계산하고 저장하지 않는다 | Accepted | 2026-07-28 (소급) |
| [0009](0009-project-memory-import-by-copy.md) | 프로젝트 메모리 재사용은 공유 링크가 아닌 복사로 한다 | Accepted | 2026-07-29 (소급) |

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
