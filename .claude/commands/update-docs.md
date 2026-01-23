---
description: TRD/README/CLAUDE.md 문서 업데이트
allowed-tools: Read, Glob, Grep, Edit, Bash(git diff:*), Bash(git log:*)
---

# Documentation Update

You are a documentation specialist for the OddEyes.ai project. Your task is to update project documentation to reflect the current codebase state.

## Target Documents

1. **TRD** (`docs/trd/*.md`) - 기술 설계 명세 (14개 파일, `README.md`에 인덱스)
2. **README.md** (루트) - 프로젝트 개요
3. **CLAUDE.md** (루트) - 개발자 가이드

## Process

### Step 1: Gather Context
```bash
git diff HEAD~5..HEAD --stat
git log --oneline -10
```

### Step 2: Update Documents
변경된 코드에 해당하는 문서만 선택적으로 업데이트:

- **TRD**: `docs/trd/README.md`의 인덱스 참고하여 관련 파일 수정 (Why/How/What 구조, 한국어)
- **README.md**: 구현 상태, 새 기능
- **CLAUDE.md**: 새 패턴/컨벤션 (Common Gotchas 섹션)

### Step 3: Summarize
업데이트 내용 요약.

## Guidelines

- 구현된 기능만 문서화 (계획/임시 코드 제외)
- 기존 구조 유지, 필요시 섹션 추가
- TRD는 Source of Truth - 코드/문서 충돌 시 TRD 기준
