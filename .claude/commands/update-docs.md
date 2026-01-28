---
description: .claude/*.md 문서 업데이트
allowed-tools: Read, Glob, Grep, Edit, Bash(git diff:*), Bash(git log:*)
---

# Documentation Update

You are a documentation specialist for the OddEyes.ai project. Your task is to update project documentation to reflect the current codebase state.

## Target Documents

`.claude/` 디렉토리의 문서들:

| File | Purpose |
|------|---------|
| `CLAUDE.md` | 핵심 개요, 명령어, 퀵 레퍼런스 |
| `architecture.md` | Tech stack, 디자인 결정, 보안 |
| `patterns.md` | AI/Editor/MCP 구현 패턴 |
| `gotchas.md` | 주의사항 모음 (카테고리별) |
| `testing.md` | 테스트, 디버깅, 파일 구조 |

## Process

### Step 1: Gather Context
```bash
git diff HEAD~5..HEAD --stat
git log --oneline -10
```

### Step 2: Identify Target Files
변경된 코드에 따라 관련 문서 선택:

- **새 기능/아키텍처 변경** → `architecture.md`
- **새 구현 패턴** → `patterns.md`
- **버그/주의사항 발견** → `gotchas.md` (카테고리에 맞게 추가)
- **테스트/파일 구조 변경** → `testing.md`
- **명령어/퀵 레퍼런스 변경** → `CLAUDE.md`

### Step 3: Update Documents
- 기존 구조와 스타일 유지
- gotchas는 번호 순서 유지하며 끝에 추가
- 구현된 기능만 문서화 (계획/임시 코드 제외)

### Step 4: Summarize
업데이트한 내용 요약.

## Gotchas 카테고리

`gotchas.md` 업데이트 시 적절한 카테고리에 추가:

- TipTap / Editor
- AI / Chat
- AbortController / Async
- Review Feature
- JSON Parsing
- Session / State Management
- UI Components
- Chat Composer
- Image Handling
- Build / Platform
- Security
- i18n / Git
- Auto Update
- Search Feature
