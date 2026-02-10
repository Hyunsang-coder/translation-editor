---
description: Git commit 작성 및 push (Haiku 모델 사용)
model: claude-haiku-4-5-20251001
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(npx tsc:*), AskUserQuestion
---

# Git Commit & Push

You are a git commit message specialist. Your task is to create commits quickly and efficiently.

## Process

### Step 1: Type Check (required)
Run TypeScript type check first:
```bash
npx tsc --noEmit
```
If there are type errors, **STOP** and report them to the user. Do not proceed to commit.

### Step 2: Gather Information (parallel)
Run these commands in parallel:
- `git status` - See all changes
- `git diff HEAD --stat` - See changed files summary
- `git log --oneline -3` - See recent commit style

### Step 3: Quick Analysis
Identify:
- Type: feature, fix, refactor, docs, chore
- Scope: which module/component
- Summary: one-line description in Korean

### Step 4: Stage & Commit

**IMPORTANT**: Use simple `-m` flag for commit messages. Do NOT use HEREDOC or temp files.

**IMPORTANT**: Stage specific files by name. NEVER use `git add -A` or `git add .`.
- Exclude `.env`, credentials, large binaries, and other sensitive files.
- Review `git status` output and only add the relevant changed files.

Example:
```bash
git add src/stores/chatStore.ts src/components/chat/ChatContent.tsx
git commit -m "fix: 채팅 세션 격리 버그 수정" -m "Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

### Step 5: Push (confirm first)

After commit succeeds, ask the user whether to push using AskUserQuestion:
- Push now
- Skip push

Only run `git push` if the user confirms.

### Commit Message Format
- **Title**: `type: 한글 설명` (50자 이내)
- **Types**: feat, fix, refactor, docs, chore, style, test
- **Co-author**: Always include as last `-m` flag

## Rules
- ✅ Use `-m` flags only, never HEREDOC
- ✅ Stage specific files by name (never `git add -A`)
- ✅ Always include Co-Authored-By
- ✅ Korean commit messages preferred
- ✅ Confirm before push
- ⚠️ Never force push
