---
description: 버전 업데이트 (package.json, Cargo.toml, tauri.conf.json 동기화)
allowed-tools: Read, Edit, Bash(git diff:*), Bash(git log:*)
---

# Version Bump

모든 버전 파일을 동기화하여 업데이트합니다.

## Version Files

다음 3개 파일의 버전을 동시에 관리:
- `package.json` → `"version": "x.y.z"`
- `src-tauri/Cargo.toml` → `version = "x.y.z"`
- `src-tauri/tauri.conf.json` → `"version": "x.y.z"`

## Process

### Step 1: 현재 버전 확인

각 파일에서 현재 버전을 읽어 표시:
```
📦 Current Versions:
   package.json:      x.y.z
   Cargo.toml:        x.y.z
   tauri.conf.json:   x.y.z
```

버전이 불일치하면 경고 표시.

### Step 2: 변경사항 분석

최근 커밋과 변경사항을 분석하여 적절한 버전 타입 제안:
- `git log --oneline -10` - 최근 커밋 확인
- `git diff HEAD~10..HEAD --stat` - 변경된 파일 통계

### Step 3: SemVer 타입 제안

변경 내용에 따라 권장 버전 타입 제시:

| 타입 | 조건 | 예시 |
|------|------|------|
| **major** | Breaking changes, 대규모 리팩토링 | 1.0.0 → 2.0.0 |
| **minor** | 새 기능 추가, 하위 호환 | 1.0.0 → 1.1.0 |
| **patch** | 버그 수정, 문서 수정 | 1.0.0 → 1.0.1 |

사용자에게 다음 형식으로 확인:
```
🔄 Suggested version bump: minor (1.0.0 → 1.1.0)

   Recent changes:
   - feat: Add new review panel
   - fix: Resolve chat streaming issue

   Proceed with minor bump? (or specify: major/minor/patch/custom)
```

### Step 4: 버전 업데이트 실행

사용자 확인 후 3개 파일 모두 수정:

1. **package.json**
   ```json
   "version": "NEW_VERSION"
   ```

2. **src-tauri/Cargo.toml**
   ```toml
   version = "NEW_VERSION"
   ```

3. **src-tauri/tauri.conf.json**
   ```json
   "version": "NEW_VERSION"
   ```

### Step 5: 결과 확인

수정 완료 후 결과 표시:
```
✅ Version bumped: 1.0.0 → 1.1.0

   Updated files:
   ✓ package.json
   ✓ src-tauri/Cargo.toml
   ✓ src-tauri/tauri.conf.json

   Next steps:
   - Review changes with `git diff`
   - Commit with `/commit` when ready
```

## Usage Examples

```
/bump-version              # 자동 분석 후 제안
/bump-version patch        # patch 버전 업데이트
/bump-version minor        # minor 버전 업데이트
/bump-version major        # major 버전 업데이트
/bump-version 2.0.0        # 특정 버전으로 설정
```

## Guidelines

### 버전 타입 판단 기준

**Major (Breaking)**
- API 시그니처 변경
- 데이터베이스 스키마 변경 (마이그레이션 필요)
- 주요 UI/UX 패러다임 변경
- 의존성 major 업그레이드

**Minor (Feature)**
- 새로운 기능 추가
- 새로운 설정 옵션
- 성능 개선
- 새로운 UI 컴포넌트

**Patch (Fix)**
- 버그 수정
- 오타 수정
- 문서 업데이트
- 스타일 변경

### 주의사항

- 릴리즈 전에만 버전 업데이트 (개발 중 빈번한 업데이트 지양)
- alpha/beta 브랜치에서는 prerelease suffix 고려 (e.g., `1.1.0-alpha.1`)
- 3개 파일 모두 동일 버전 유지 필수
