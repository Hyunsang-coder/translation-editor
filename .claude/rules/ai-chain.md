---
paths: ["src/ai/**/*"]
alwaysApply: false
---

# AI Chain Rules

LangChain 및 AI 통합 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] Tool handler에서 `project` null 체크 필수
- [ ] `abortSignal`을 `streamAssistantReply`에 명시적 전달
- [ ] 매 청크 처리 시 `getState()`로 최신 상태 참조 (stale closure 방지)
- [ ] Markdown 변환 extension 동기화 (`markdownConverter.ts` ↔ `TipTapEditor.tsx`)

## Two Modes

### Translation Mode (`translateDocument.ts`)
- **입력**: TipTap JSON → Markdown (via `tiptap-markdown`)
- **출력**: `---TRANSLATION_START/END---` 마커로 감싸진 Markdown
- **채팅 히스토리**: 미포함
- **이미지**: `extractImages()` → 플레이스홀더 → `restoreImages()`

### Chat Mode (`chat.ts`)
- **문서 접근**: Tool Calling으로 on-demand fetch (초기 페이로드에 미포함)
- **채팅 히스토리**: 최근 20개 (`VITE_AI_MAX_RECENT_MESSAGES`)
- **Tool loop**: 기본 6 steps, 최대 12

## Token Limits

| 항목 | 최대 |
|-----|-----|
| Translation Rules | 10,000자 |
| Project Context | 30,000자 |
| Glossary | 30,000자 |
| Documents | 100,000자 |

## Common Pitfalls

1. **AbortSignal 미전파**: 취소해도 응답 계속 수신 → `abortSignal` 명시적 전달
2. **Tool 무한루프**: Tool 응답이 다시 Tool 호출 유발 → `maxSteps` 제한 확인
3. **Markdown 마커 누락**: `extractTranslationMarkdown()` 폴백 로직 확인
4. **Truncation 미감지**: 열린 코드블록, 미완성 링크 체크
