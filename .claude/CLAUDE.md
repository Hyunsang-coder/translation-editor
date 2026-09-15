# CLAUDE.md

OddEyes.ai is a translator-led desktop editor built with Tauri, Rust, React, TypeScript, TipTap, and Zustand. AI may propose changes, but never applies them without confirmation.

## Non-negotiable contracts

1. **Preview first**: AI output is reviewed before it changes a document ([ADR-0003](../docs/adr/0003-no-auto-apply-preview-first.md)).
2. **TipTap JSON is canonical**: do not bypass it for document persistence ([ADR-0002](../docs/adr/0002-tiptap-json-as-canonical-format.md)).
3. **Markdown is the AI interchange format**, not the stored document format.
4. Add user-facing strings to both `src/i18n/locales/ko.json` and `en.json`.

## Commands

```bash
npm run tauri:dev       # desktop development
npm run build           # TypeScript + frontend build
npm run test:run        # Vitest once
npm run test:harness    # background gate: Vitest + Rust
npm run test:e2e:web    # optional Playwright UI coverage
npm run test:e2e        # optional Tauri build smoke
npm run test:tauri      # release gate
```

Use `.claude/testing.md` only when changing tests or debugging a failure.

## Code map

- `src/ai/`: model calls, prompts, review, and AI tools
- `src/components/`, `src/editor/`: UI and TipTap behavior
- `src/stores/`: Zustand state and persistence orchestration
- `src/desktop/`: OddEyes desktop MCP bridge
- `src-tauri/src/`: Rust backend and Tauri commands

Read `.claude/architecture.md`, `patterns.md`, or `gotchas.md` only when the task touches that subject.

## Documentation policy

Agent docs are working context, not a changelog:

- current architecture or contract → replace content in `architecture.md` / `patterns.md`
- repeatable implementation trap → add a concise, topic-grouped item to `gotchas.md`
- costly or hard-to-reverse decision → `docs/adr/`
- history → Git

Keep this file session-wide and under 150 lines. Do not add release notes, recent-update sections, exhaustive file lists, or task-specific instructions.

## Version sync

Keep these aligned when bumping versions:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
