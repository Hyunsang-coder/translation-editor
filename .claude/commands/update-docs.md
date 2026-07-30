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

## 절대 규칙

**CLAUDE.md에 변경 이력을 쓰지 않는다.** `Recent Updates`·`Previous (날짜)` 같은 날짜별 섹션을 만들거나 되살리지 않는다. 이 파일은 매 세션 자동으로 실려가는 프롬프트이고, 이력은 낡아도 사라지지 않아 결국 현재 코드와 모순된다 (2026-07-30에 13개 날짜 섹션 ~14.8k 토큰을 이 이유로 걷어냈다).

작업 결과는 **종류에 따라** 배분한다:

| 내용 | 목적지 |
|------|--------|
| 되돌리기 비싼 결정, 버린 대안 | `docs/adr/NNNN-*.md` 신규 + `docs/adr/README.md` 목록 한 줄 |
| 다시 밟으면 아픈 구현 함정 | `gotchas.md` 해당 카테고리 (번호 이어서) |
| 현재 구조·계약 | `architecture.md` / `patterns.md` — **덧붙이지 말고 낡은 서술을 갈아끼운다** |
| 언제 무엇이 바뀌었나 | 아무 문서에도 쓰지 않는다 (`git log`) |

**상한**: CLAUDE.md 300줄. 넘기면 무엇을 뺄지 먼저 정한다. 마지막에 `wc -l .claude/CLAUDE.md`로 확인한다.

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

# 규칙 5: 명령어/참조 변경 → CLAUDE.md
grep -E "package.json|Cargo.toml|tauri.conf" /tmp/changed_files.txt
```

**선택 결과 예시:**
```
patterns.md      ← src/editor/*, src/stores/*
architecture.md  ← src/ai/*, src-tauri/src/mcp/*
testing.md       ← *.test.ts, src-tauri/**/*.rs
gotchas.md       ← 버그/주의사항 키워드 있을 시 (fix:, refactor:, chore:)
CLAUDE.md        ← 버전/명령어 변경 시
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

#### CLAUDE.md 업데이트
- **변경 대상**: 버전, 명령어, 퀵 레퍼런스, 디렉터리 구조 — **행동을 바꾸는 상시 정보만**
- **작업**: 낡은 서술을 갈아끼운다. 이력 섹션은 만들지 않는다 (위 "절대 규칙")
- **검증**: `wc -l .claude/CLAUDE.md` ≤ 300

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
