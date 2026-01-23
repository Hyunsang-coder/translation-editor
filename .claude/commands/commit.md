---
description: Git commit 작성 및 push (Haiku 모델 사용)
model: claude-haiku-4-5-20251001
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(npx tsc:*)
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

### Step 4: Execute Commit & Push

**IMPORTANT**: Use simple `-m` flag for commit messages. Do NOT use HEREDOC or temp files.

For single-line commits:
```bash
git add -A && git commit -m "fix: 버그 수정 내용" && git push
```

For multi-line commits, use multiple `-m` flags:
```bash
git add -A && git commit -m "fix: 제목" -m "상세 설명" -m "Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>" && git push
```

### Commit Message Format
- **Title**: `type: 한글 설명` (50자 이내)
- **Types**: feat, fix, refactor, docs, chore, style, test
- **Co-author**: Always include as last `-m` flag

Example:
```bash
git add -A && git commit -m "feat: 채팅에서 전체 번역 지원" -m "Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>" && git push
```

## Rules
- ✅ Use `-m` flags only, never HEREDOC
- ✅ Chain commands with `&&` for speed
- ✅ Korean commit messages preferred
- ⚠️ Never force push
