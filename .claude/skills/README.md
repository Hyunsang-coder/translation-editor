# OddEyes.ai Skills

프로젝트 전용 Claude Code 스킬 정의.

## 사용법

Claude Code에서 슬래시 명령어로 실행:

```
/typecheck       # Rust + TS 타입 체크
/sync-types      # Rust ↔ TS 타입 동기화
/dev             # 개발 서버 실행
/test-ai         # AI 페이로드 테스트
```

## 스킬 목록

| 스킬 | 파일 | 용도 |
|-----|------|------|
| `/typecheck` | `typecheck.md` | Rust + TypeScript 동시 타입 체크 |
| `/sync-types` | `sync-types.md` | Rust struct ↔ TS interface 동기화 검증 |
| `/dev` | `dev.md` | Tauri 개발 서버 실행 + 로그 모니터링 |
| `/test-ai` | `test-ai.md` | AI 프롬프트/페이로드 dry-run 테스트 |

## 권장 워크플로우

### 개발 시작
```
/typecheck           # 현재 상태 확인
/dev --check-first   # 체크 후 서버 시작
```

### 타입 작업
```
/sync-types --check  # 불일치 확인
/sync-types --diff   # 차이점 상세 보기
# 수정 후
/typecheck           # 검증
```

### AI 기능 개발
```
/test-ai --tokens           # 토큰 사용량 확인
/test-ai --mode translate   # 페이로드 미리보기
# 프롬프트 수정 후
/test-ai --live             # 실제 테스트
```

### 커밋 전
```
/typecheck           # 최종 타입 체크
/sync-types --check  # 타입 동기화 확인
```

## 스킬 확장

새 스킬 추가 시 이 디렉토리에 `.md` 파일로 생성:

```markdown
# /skill-name

[설명]

## Usage
[사용법과 플래그]

## Execution Steps
[실행 단계]

## Output Format
[출력 형식 예시]

## Common Issues
[자주 발생하는 문제]

## Integration
[다른 스킬/agent와 연계]
```

## Agent 연계

스킬과 subagent는 함께 동작합니다:

| 스킬 | 관련 Agent |
|-----|-----------|
| `/typecheck` | tauri-bridge, store-sync |
| `/sync-types` | tauri-bridge |
| `/dev` | tauri-bridge, store-sync |
| `/test-ai` | ai-chain, store-sync |

에러 발생 시 관련 agent 문서 참조:
```
@.claude/agents/tauri-bridge.md
@.claude/agents/ai-chain.md
```
