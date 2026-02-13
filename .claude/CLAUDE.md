# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**OddEyes.ai** - Professional translation workstation built with Tauri (Rust) + React (TypeScript).
- Notion-style dual editor (TipTap) for Source/Target documents
- AI chat with LangChain (OpenAI + Anthropic)
- MCP integration (Confluence, Notion, Web Search)
- History snapshot workflow (save/compare/restore/rename, including snapshot↔snapshot diff)

**Core Philosophy**: Translator-led workflow. AI assists only when requested.

## Quick Reference

### Commands
```bash
npm install              # Install dependencies
npm run tauri:dev        # Dev server (frontend + Tauri)
npm run tauri:build      # Build release app
npm run lint             # ESLint
npm test                 # Vitest watch mode
npm run test:run         # Single test run
npm run test:e2e:web     # Playwright web E2E
npm run test:ci:local    # CI verify equivalent (lint+unit+web e2e+cargo test)
npm run test:tauri       # Full pre-deploy gate (lint+unit+e2e+rust+release)
npm run test:e2e         # Tauri smoke test (Playwright)
cd src-tauri && cargo test  # Rust tests only
```

### Dev Environment Setup
```bash
# Keychain 암호 프롬프트 우회 (.gitignore 포함, 한 번만 설정)
# 기존 vault 호환: security find-generic-password -s "com.ite.app" -a "ite:master_key_v1" -w
# 새 환경: 아무 문자열 가능 (SHA-256 해싱)
echo 'ITE_DEV_MASTER_KEY=mypassword' > .env.local

# (선택) 테스트(vitest)에서만 API 키 fallback 사용
# 런타임 앱(Tauri)에서는 사용되지 않으며, 앱 설정/OS 보안저장소 키가 우선입니다.
echo 'OPENAI_API_KEY=...' >> .env.local
echo 'ANTHROPIC_API_KEY=...' >> .env.local
```

주의:
- `.env.local`은 로컬 전용 파일입니다. 실제 키를 저장소에 커밋하지 마세요.
- 테스트가 아닌 실제 앱 실행에서는 Settings에서 입력한 API 키(secure store)가 사용됩니다.

### Key Directories
```
src/ai/           # AI integration (chat.ts, translateDocument.ts, review/)
src/editor/       # TipTap extensions
src/stores/       # Zustand stores (chatStore: 7 슬라이스)
src/components/   # React components
src/components/history/  # History snapshot UI (timeline/compare/restore/rename)
src-tauri/src/    # Rust backend (commands/, mcp/)
```

### Version Files (Keep in Sync)
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (Cargo.toml 변경 시 `cargo check`로 자동 갱신)
- `src-tauri/tauri.conf.json`

## Documentation Structure

This `.claude/` directory contains:
- `architecture.md` - Tech stack, design decisions, security
- `patterns.md` - AI/Editor/MCP implementation patterns
- `gotchas.md` - Critical implementation warnings (137 items)
- `review-audit.md` - Review feature code audit (13 issues, 10 strengths)
- `testing.md` - Testing, debugging, file organization

## Core Principles

1. **No Auto-Apply**: AI never modifies documents without user confirmation
2. **Preview-First**: Translation results shown in modal before applying
3. **TipTap JSON is Canonical**: Never bypass JSON format for document storage
4. **Markdown for AI**: Translation uses Markdown as intermediate format

## Recent Updates (2026-02-14)

- **View 메뉴 + 메뉴 이벤트 브리지**: Rust 네이티브 View 메뉴에 Project/Settings/Review/Chat 항목 추가. `CustomEvent('tauri-menu')` 기반 양방향 동기화 (Chat은 CheckMenuItem으로 체크 상태 반영).
- **Chat 전역 토글 중앙화**: `uiStore.toggleChatVisibility()` — Toolbar + View 메뉴 모두 동일 액션 사용. 양쪽 사이드바 chat 패널 On/Off 통합 제어.
- **tsconfig ES2022**: `lib: ES2020 → ES2022` 업그레이드 (`Array.at()`, `Object.hasOwn()` 등 사용 가능).
- **E2E 테스트 확장**: `user-story.spec.ts` Phase 9 (프로젝트 Duplicate) 추가 (6→7 TC).
- **Manual update check**: AppSettingsModal Help & Info 섹션에 "업데이트 확인" 버튼 추가. `check()` 직접 호출 → custom event(`app:update-found`)로 기존 UpdateModal 재사용.

## Adding New Features

1. Update relevant Zustand store(s)
2. Add Tauri command if backend logic needed
3. Create/update UI components
4. Add i18n keys to both `ko.json` and `en.json`
5. Test with real AI API calls
6. Verify SQLite persistence across sessions
