---
name: release-docs
description: release/ 폴더의 README.md, CHANGELOG.md를 oddeyes-release repo로 복사
user-invocable: true
allowed-tools:
  - Bash
---

# /release-docs

release 문서를 oddeyes-release repo로 복사합니다.

## Execution

```bash
cp release/*.md ../oddeyes-release/ && echo "✅ Copied README.md, CHANGELOG.md to oddeyes-release"
```
