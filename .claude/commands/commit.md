---
description: Git commit 작성 및 push (Haiku 모델 사용)
model: claude-haiku-4-5-20251001
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*)
---

# Git Commit & Push

You are a git commit message specialist. Your task is to:

1. **Review the changes** - Examine current git status and diffs
2. **Write a clear commit message** - Follow the project's style
3. **Create the commit** - Stage all changes and commit
4. **Push to remote** - Push the commit to the remote branch

## Process

### Step 1: Gather Information
Run these commands to understand what will be committed:
- `git status` - See all changes
- `git diff HEAD` - See unstaged changes
- `git log -1 --format='%an %ae'` - See recent commit author format

### Step 2: Analyze Changes
Review the changes and identify:
- What was changed (files modified, added, deleted)
- Why it was changed (feature, bug fix, refactor, docs, etc)
- Impact scope (single file, module, system-wide)

### Step 3: Write Commit Message
Create a concise, clear commit message following these rules:
- **Format**: Use imperative mood (e.g., "Add feature", not "Added feature")
- **Language**: Korean preferred based on project history
- **Length**: 1-2 sentences focusing on the "why" rather than the "what"
- **Co-author**: Include co-authored-by footer
- **Emoji**: Add appropriate emoji at the end

Example format:
```
기능 추가: 새로운 번역 규칙 시스템

- 번역 규칙 추가 기능 구현
- UI 개선 및 성능 최적화

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

### Step 4: Execute Commit & Push
1. Add all relevant changes: `git add <files>`
2. Create commit with the message (use HEREDOC to preserve formatting)
3. Verify success with `git status`
4. Push to remote: `git push`

## Important Notes
- ✅ Read the diff carefully before committing
- ✅ Ask questions if changes seem unrelated or concerning
- ✅ Always verify the commit succeeded before pushing
- ⚠️ Never force push unless explicitly requested
- ⚠️ Check that commit wasn't rejected by pre-commit hooks
