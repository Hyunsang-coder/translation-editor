---
name: "source-command-update-docs"
description: ".Codex/*.md 문서 업데이트"
---

# source-command-update-docs

Use this skill when the user asks to run the migrated source command `update-docs`.

## Command Template

# Documentation Update

You are a documentation specialist for the OddEyes.ai project. Your task is to update project documentation to reflect the current codebase state.

## Target Documents

`.Codex/` 디렉토리의 문서들:

| File | Purpose |
|------|---------|
| `AGENTS.md` | 핵심 개요, 명령어, 퀵 레퍼런스 |
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

### Step 2: Identify Target Files (자동 감지)

```bash
# 변경된 파일 목록 분석
git diff HEAD~N..HEAD --name-only | tee /tmp/changed_files.txt

# 자동 매핑 규칙
# 규칙 1: Editor/TipTap 변경 → patterns.md
grep -E "^src/editor/|^src/stores/editorStore" /tmp/changed_files.txt

# 규칙 2: AI/Tauri 아키텍처 변경 → architecture.md
grep -E "^src/ai/|^src-tauri/src/mcp/|^src-tauri/src/commands/" /tmp/changed_files.txt

# 규칙 3: 테스트 추가/변경 → testing.md
grep -E "\.test\.ts$|^src-tauri/.*\.rs$" /tmp/changed_files.txt

# 규칙 4: Store/상태 관리 변경 → patterns.md + gotchas.md
grep -E "^src/stores/" /tmp/changed_files.txt

# 규칙 5: 명령어/참조 변경 → AGENTS.md
grep -E "package.json|Cargo.toml|tauri.conf" /tmp/changed_files.txt
```

**선택 결과 예시:**
```
patterns.md      ← src/editor/*, src/stores/*
architecture.md  ← src/ai/*, src-tauri/src/mcp/*
testing.md       ← *.test.ts, src-tauri/**/*.rs
gotchas.md       ← 버그/주의사항 키워드 있을 시 (fix:, refactor:, chore:)
AGENTS.md        ← 버전/명령어 변경 시
```

**자동으로 감지된 대상 문서 확인 후 아래 Step 3 진행**

### Step 3: Update Documents

**Step 2에서 감지된 각 문서에 대해:**

#### patterns.md 업데이트
- **변경 대상**: TipTap/Editor, 상태 관리 (Zustand) 패턴
- **작업**:
  1. 제거된 파일 참조 → 최신 파일 경로로 변경
  2. 새 패턴 추가 (예: `useEditorStore`, Plugin Keys)
  3. 구식 패턴 표시 (❌ 구식 패턴)
- **검증**: Dead link 감지 (`src/` 경로가 실제로 존재하는지)

#### architecture.md 업데이트
- **변경 대상**: AI 파이프라인, Tauri 커맨드, MCP 통합
- **작업**: 새로운 기능/아키텍처 결정사항 추가

#### testing.md 업데이트
- **변경 대상**: 테스트 추가/구조 변경
- **작업**: 테스트 케이스 명시, 디버깅 팁 추가

#### gotchas.md 업데이트
- **변경 대상**: 버그/주의사항 (커밋 메시지 키워드: fix:, chore:, refactor:)
- **작업**: 적절한 카테고리에 추가 (번호 순서 유지)

#### AGENTS.md 업데이트
- **변경 대상**: 버전, 명령어, 퀵 레퍼런스
- **작업**: 필요시 업데이트

### Step 4: Summarize
업데이트한 각 문서별 변경 사항 요약:
```
✅ patterns.md
   - editorRegistry.ts → useEditorStore (2건)
   - Plugin Key 중앙화 추가 (1건)

✅ gotchas.md
   - [카테고리명] 새 항목 추가 (N건)

✅ architecture.md
   - (변경 없음)
```

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
