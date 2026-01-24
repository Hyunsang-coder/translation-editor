# OddEyes.ai Skills

프로젝트 전용 Claude Code Skills (공식 형식).

> **최종 업데이트**: 2026-01

## 스킬 목록

| 스킬 | 설명 |
|-----|------|
| `/typecheck` | Rust + TypeScript 동시 타입 체크 |
| `/sync-types` | Rust struct ↔ TS interface 동기화 검증 |
| `/dev` | Tauri 개발 서버 실행 + 로그 모니터링 |
| `/test-ai` | AI 프롬프트/페이로드 dry-run 테스트 |
| `/tdd` | TDD 워크플로우 (Red-Green-Refactor) |

## 디렉토리 구조

```
.claude/skills/
├── typecheck/SKILL.md    # /typecheck
├── sync-types/SKILL.md   # /sync-types
├── dev/SKILL.md          # /dev
├── test-ai/SKILL.md      # /test-ai
├── tdd/SKILL.md          # /tdd
└── README.md
```

## 사용법

Claude Code에서 슬래시 명령어로 실행:

```
/typecheck           # Rust + TS 타입 체크
/sync-types          # Rust ↔ TS 타입 동기화
/dev                 # 개발 서버 실행
/test-ai             # AI 페이로드 테스트
/tdd                 # TDD 워크플로우
```

## 권장 워크플로우

### 개발 시작
```
/typecheck           # 현재 상태 확인
/dev --check-first   # 체크 후 서버 시작
```

### 타입 작업
```
/sync-types --check  # 불일치 확인
/sync-types --diff   # 차이점 상세 보기
# 수정 후
/typecheck           # 검증
```

### AI 기능 개발
```
/test-ai --tokens           # 토큰 사용량 확인
/test-ai --mode translate   # 페이로드 미리보기
# 프롬프트 수정 후
/test-ai --live             # 실제 테스트
```

### 커밋 전
```
/typecheck           # 최종 타입 체크
/sync-types --check  # 타입 동기화 확인
```

## 스킬 추가

새 스킬은 `skills/skill-name/SKILL.md` 형식으로 생성:

```yaml
---
name: skill-name
description: 스킬 설명 (Claude가 자동 선택 기준으로 사용)
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /skill-name

[스킬 내용]
```
