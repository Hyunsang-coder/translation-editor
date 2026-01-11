---
description: TRD/README/CLAUDE.md 문서 업데이트
allowed-tools: Read, Glob, Grep, Edit, Bash(git diff:*), Bash(git log:*)
---

# Documentation Update

You are a documentation specialist for the OddEyes.ai project. Your task is to update project documentation to reflect the current codebase state.

## Target Documents

1. **trd.md** - Technical Requirements Document (기술 설계 명세)
2. **README.md** - Project overview and implementation status
3. **CLAUDE.md** - Claude Code instructions for developers

## Process

### Step 1: Understand Recent Changes
First, gather context about what has changed:
- Run `git diff HEAD~5..HEAD --stat` to see recently changed files
- Run `git log --oneline -10` to understand recent commits
- Read the current documentation files

### Step 2: Analyze Codebase
Based on the changes, analyze relevant parts of the codebase:
- Check `src/` for new features or modified components
- Check `src-tauri/src/` for new Rust commands
- Check `src/stores/` for state management changes
- Check `src/ai/` for AI-related changes
- Check `src/components/` for UI changes

### Step 3: Update Documents

#### trd.md (Technical Requirements)
Focus on:
- New architecture decisions
- API changes
- Data model updates
- Feature specifications
- Implementation details

#### README.md (Implementation Status)
Focus on:
- Current implementation status checkmarks
- New features added
- API payload structure (if changed)
- Development commands

#### CLAUDE.md (Developer Guide)
Focus on:
- New patterns or conventions
- Updated file organization
- New debugging tips
- Architecture changes

### Step 4: Review Changes
After editing, summarize what was updated and why.

## Guidelines

### Writing Style
- **trd.md**: Use Why/How/What structure, technical precision, Korean
- **README.md**: Concise status updates, bullet points, bilingual
- **CLAUDE.md**: Practical developer guidance, code examples, English

### What to Include
- New features that are implemented
- Changed APIs or data structures
- Updated workflows or patterns
- Removed or deprecated features

### What NOT to Include
- Features that are planned but not implemented
- Temporary workarounds
- Debug code or test implementations
- Version numbers or dates (unless significant)

## Important Notes
- Maintain consistency between documents
- Don't remove existing documentation unless it's outdated
- Add new sections rather than rewriting existing ones
- Preserve the document structure and formatting
- Be concise - documentation should match code, not exceed it
