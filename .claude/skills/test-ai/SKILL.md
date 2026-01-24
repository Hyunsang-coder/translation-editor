---
name: test-ai
description: AI 프롬프트와 페이로드 테스트. Dry-run으로 실제 API 호출 없이 토큰 사용량과 구조를 검증합니다. 프롬프트 수정 후 또는 토큰 최적화 시 사용.
argument-hint: "[--mode translate|chat] [--tokens] [--live]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

# /test-ai

AI 프롬프트와 페이로드를 테스트합니다.

## Usage

```
/test-ai                    # 현재 설정으로 페이로드 미리보기
/test-ai --mode translate   # 번역 모드 페이로드 테스트
/test-ai --mode chat        # 채팅 모드 페이로드 테스트
/test-ai --tokens           # 토큰 사용량 추정
/test-ai --live             # 실제 API 호출 (주의!)
```

## Translation Mode Validation

- System prompt 구성 확인
- Source document → Markdown 변환
- Translation rules, Project context 포함
- Glossary 매칭 항목
- 이미지 플레이스홀더 변환
- Output markers: `---TRANSLATION_START/END---`

## Chat Mode Validation

- Chat history ≤ 20 messages
- Tool definitions (Markdown 반환)
- Documents NOT in initial payload (on-demand)
- maxSteps: 6 (max 12)

## Token Limits (GPT-5 400k)

| 항목 | 최대 |
|-----|-----|
| Translation Rules | 10,000자 |
| Project Context | 30,000자 |
| Glossary | 30,000자 |
| Documents | 100,000자 |
| Output (번역) | 65,536 토큰 |

## Output Format

```
═══════════════════════════════════════════════════════════
              [MODE] MODE - DRY RUN
═══════════════════════════════════════════════════════════

📋 PAYLOAD STRUCTURE
📊 TOKEN ESTIMATION
⚠️  WARNINGS (if any)
✅ VALIDATION PASSED / ❌ VALIDATION FAILED

═══════════════════════════════════════════════════════════
```

## Common Issues

- **Token Limit**: glossary/context 줄이기 또는 문서 분할
- **Invalid Markdown**: markers 확인, fallback 로직 점검
- **Tool Call Loop**: maxSteps 도달 시 tool 응답 형식 검토
