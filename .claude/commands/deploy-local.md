---
description: 릴리스 빌드 후 /Applications의 OddEyes.ai 설치본 교체
allowed-tools: Bash(npm run install:local), Bash(npm run install:local:*), Bash(pgrep:*), Bash(defaults:*), Bash(git status:*)
---

# Local Deploy

로컬 릴리스 빌드를 만들고 `/Applications/OddEyes.ai.app` 설치본을 교체합니다.

## Process

1. 현재 작업 트리 상태를 확인하고, 기존 사용자 변경사항은 건드리지 않습니다.
2. 사용자가 앱을 종료하지 않았다면 먼저 종료를 요청합니다. 실행 중인 앱을 강제로 종료하지 않습니다.
3. 기본적으로 다음 명령을 실행해 새로 빌드합니다:

```bash
npm run install:local
```

4. 사용자가 명시적으로 `skip-build` 또는 `--skip-build`을 요청한 경우에만 다음 명령을 사용합니다:

```bash
npm run install:local -- --skip-build
```

5. 명령이 출력한 설치 버전과 `/Applications/OddEyes.ai.app`의 `CFBundleShortVersionString`을 확인합니다.
6. 빌드 또는 설치가 실패하면 원인과 현재 설치본 상태를 보고합니다.

## Usage Examples

```
/deploy-local                 # 새 릴리스 빌드 후 설치본 교체
/deploy-local --skip-build   # 기존 검증된 산출물만 설치
```

## Notes

- `install:local`이 실행 중인 설치본을 감지하면 안전을 위해 중단합니다.
- 설치 스크립트가 빌드 산출물 버전과 설정 버전을 검증하고, 복사/검증 실패 시 이전 설치본으로 되돌립니다.
- 로컬 설치에는 업데이터 서명이 필요하지 않으므로 서명 키가 없다는 경고는 로컬 교체 자체를 막지 않습니다.
