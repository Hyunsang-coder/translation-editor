---
description: 버전 업데이트 (package.json, Cargo.toml, Cargo.lock, tauri.conf.json 동기화)
allowed-tools: Read, Edit, Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git tag:*), Bash(git push:*), Bash(git status:*), Bash(git branch:*), Bash(gh release:*), Bash(grep:*), AskUserQuestion
---

# Version Bump

버전 파일 동기화 + 커밋 + 태그 + 푸시를 한 번에 처리합니다.

## Version Files

다음 4개 파일의 버전을 동기화:
- `package.json` → `"version": "x.y.z"` (직접 수정)
- `src-tauri/Cargo.toml` → `version = "x.y.z"` (직접 수정)
- `src-tauri/tauri.conf.json` → `"version": "x.y.z"` (직접 수정)
- `src-tauri/Cargo.lock` → Cargo.toml 변경 후 `cargo check`로 자동 갱신됨 (커밋에 포함 필수)

## Process

### Step 1: 사전 검증

1. 현재 브랜치 확인 (`main` 또는 릴리즈 브랜치인지)
2. uncommitted changes가 있으면 경고 표시
3. 각 파일의 현재 버전 확인 및 표시:

```
📦 Current Versions:
   package.json:      x.y.z
   Cargo.toml:        x.y.z
   tauri.conf.json:   x.y.z
```

버전 불일치 시 경고.

### Step 2: 변경사항 분석 (인자 없을 때만)

`/bump-version` 인자 없이 실행 시:
- `git log --oneline -10` - 최근 커밋 확인
- 변경 내용 분석 후 버전 타입 제안

```
🔄 Suggested: minor (1.0.0 → 1.1.0)

   Recent changes:
   - feat: Add new review panel
   - fix: Resolve chat streaming issue
```

### Step 3: 버전 타입 확인

사용자에게 AskUserQuestion으로 확인:
- major / minor / patch / 직접 입력

인자가 이미 있으면 (`/bump-version patch`) 이 단계 생략.

### Step 4: 파일 수정

1. `package.json`, `Cargo.toml`, `tauri.conf.json`에 새 버전 적용
2. `cd src-tauri && cargo check` 실행 → Cargo.lock 자동 갱신

### Step 5: 커밋 + 태그 + 푸시 여부 확인

AskUserQuestion으로 확인:

```
✅ Files updated: 1.0.0 → 1.1.0

다음 작업을 수행할까요?
- [ ] 커밋만 (git commit)
- [ ] 커밋 + 태그 (git commit + git tag v1.1.0)
- [ ] 커밋 + 태그 + 푸시 (권장) ← GitHub Actions가 릴리스 생성 + 빌드 자동 시작
- [ ] 아무것도 안 함 (수동 처리)
```

### Step 6: Git 작업 실행

사용자 선택에 따라:

```bash
# 커밋
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore: bump version to 1.1.0"

# 태그 (선택 시)
git tag v1.1.0

# 푸시 (선택 시)
git push && git push origin v1.1.0
```

### Step 7: 결과 표시

```
✅ Version Release Complete: 1.0.0 → 1.1.0

   ✓ package.json
   ✓ src-tauri/Cargo.toml
   ✓ src-tauri/Cargo.lock
   ✓ src-tauri/tauri.conf.json
   ✓ Committed: "chore: bump version to 1.1.0"
   ✓ Tagged: v1.1.0
   ✓ Pushed to origin

   🚀 GitHub Actions가 자동으로 (수동 단계 없음):
      1. Draft release 생성 (create-release)
      2. 검증 + macOS/Windows 빌드 (verify, build)
      3. 아티팩트 업로드
      4. Draft → 공개 전환 (publish-release: draft=false)

      확인: https://github.com/<owner>/<repo>/actions
      결과: https://github.com/<owner>/<repo>/releases
```

publish까지 워크플로가 처리한다(`build.yml`의 `publish-release` 잡이
`needs: [create-release, verify, build]`로 게이트된 뒤 `draft: false`로 뒤집는다).
사용자에게 "빌드 후 직접 publish하라"고 안내하지 않는다.

## Usage Examples

```
/bump-version              # 분석 후 제안 → 확인 → 실행
/bump-version patch        # patch로 바로 진행 → 확인 → 실행
/bump-version minor        # minor로 바로 진행
/bump-version 2.0.0        # 특정 버전으로 설정
```

## Guidelines

### 버전 타입 판단 기준

| 타입 | 조건 | 예시 |
|------|------|------|
| **major** | Breaking changes, DB 스키마 변경 | 1.0.0 → 2.0.0 |
| **minor** | 새 기능, 성능 개선 | 1.0.0 → 1.1.0 |
| **patch** | 버그 수정, 문서, 스타일 | 1.0.0 → 1.0.1 |

### 주의사항

- 릴리즈 전에만 실행 (개발 중 빈번한 업데이트 지양)
- 태그 푸시 시 GitHub Actions가 자동으로 릴리스 생성 + 빌드 시작
- 이미 존재하는 태그는 덮어쓸 수 없음 (버전 충돌 주의)
- 릴리스 생성은 GitHub Actions가 담당 (race condition 방지)
