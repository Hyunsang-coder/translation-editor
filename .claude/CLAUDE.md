# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**OddEyes.ai** - Professional translation workstation built with Tauri (Rust) + React (TypeScript).
- Notion-style dual editor (TipTap) for Source/Target documents
- AI chat with LangChain (OpenAI + Anthropic)
- MCP integration (Confluence, Notion, Web Search)

**Core Philosophy**: Translator-led workflow. AI assists only when requested.

## Quick Reference

### Commands
```bash
npm install              # Install dependencies
npm run tauri:dev        # Dev server (frontend + Tauri)
npm run tauri:build      # Build release app
npm test                 # Vitest watch mode
npm run test:run         # Single test run
cd src-tauri && cargo test  # Rust tests
```

### Key Directories
```
src/ai/           # AI integration (chat.ts, translateDocument.ts, review/)
src/editor/       # TipTap extensions
src/stores/       # Zustand stores
src/components/   # React components
src-tauri/src/    # Rust backend (commands/, mcp/)
```

### Version Files (Keep in Sync)
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

## Documentation Structure

This `.claude/` directory contains:
- `architecture.md` - Tech stack, design decisions, security
- `patterns.md` - AI/Editor/MCP implementation patterns
- `gotchas.md` - Critical implementation warnings (68 items)
- `testing.md` - Testing, debugging, file organization

## Core Principles

1. **No Auto-Apply**: AI never modifies documents without user confirmation
2. **Preview-First**: Translation results shown in modal before applying
3. **TipTap JSON is Canonical**: Never bypass JSON format for document storage
4. **Markdown for AI**: Translation uses Markdown as intermediate format

## Adding New Features

1. Update relevant Zustand store(s)
2. Add Tauri command if backend logic needed
3. Create/update UI components
4. Add i18n keys to both `ko.json` and `en.json`
5. Test with real AI API calls
6. Verify SQLite persistence across sessions
