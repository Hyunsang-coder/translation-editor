# Confluence Word Count Tool v2 - Programmatic Approach

## Goal

`getConfluencePage` 응답에 본문을 통째로 LLM에 보내는 현재 방식을 개선하여,
MCP로 페이지를 fetch한 뒤 **프로그래밍적으로 단어 수만 계산**하여 결과값만 LLM에 반환하는 전용 도구를 만든다.

## Problem

현재 방식에서는 유저가 "이 페이지 단어 수 알려줘"라고 하면:
1. LLM이 `getConfluencePage` 호출
2. 페이지 본문 전체(수만 토큰) + 단어 수가 LLM으로 전달
3. LLM이 이를 읽고 응답

**단어 수만 필요한데 본문 전체가 LLM 컨텍스트에 들어가는 토큰 낭비 + 속도 저하.**

## Architecture (Before → After)

```
Before:
  유저 → LLM → getConfluencePage → [본문 전체 + 단어 수] → LLM (수만 토큰) → 응답

After:
  유저 → LLM → confluence_word_count({pageIds, language, sections, sectionMode, contentType})
               → 내부: MCP fetch → 프로그래밍 계산 → [JSON 수치만] → LLM (수백 토큰) → 응답
```

---

## Tool Design: `confluence_word_count`

### Zod Schema

```typescript
z.object({
  pageIds: z.array(z.string()).min(1).max(10)
    .describe('Confluence 페이지 ID 또는 URL 배열. 예: ["123456"] 또는 ["https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456/Title"]'),
  language: z.enum(['all', 'english', 'korean', 'chinese', 'japanese', 'cjk'])
    .optional().default('all')
    .describe('카운팅할 언어 필터. "all"=전체, "english"=영어만, "korean"=한국어만, "cjk"=한중일 합산'),
  sections: z.array(z.string()).optional()
    .describe('필터링할 섹션 제목(heading 텍스트) 배열. sectionMode와 함께 사용. 대소문자 무시. 예: ["API Reference", "설치 방법"]'),
  sectionMode: z.enum(['include', 'exclude']).optional().default('include')
    .describe('"include"=지정한 섹션들만 카운팅, "exclude"=지정한 섹션들을 제외하고 카운팅. sections가 없으면 무시됨'),
  contentType: z.enum(['all', 'tables', 'lists', 'paragraphs', 'headings'])
    .optional().default('all')
    .describe('콘텐츠 유형 필터. "tables"=표 안 텍스트만, "lists"=리스트만, "paragraphs"=본문만, "headings"=제목만'),
})
```

### 내부 처리 흐름

```
각 pageId에 대해:
1. extractPageIdFromUrl(pageIdOrUrl) → pageId
2. invoke('mcp_call_tool', { name: 'getConfluencePage', arguments: { pageId } }) → HTML
3. 섹션 필터링:
   - sections + "include" → filterSections(html, sections, 'include') → 지정 섹션 HTML만
   - sections + "exclude" → filterSections(html, sections, 'exclude') → 지정 섹션 제거
   - sections 없음 → 전체 HTML
4. contentType → extractContentByType(filteredHtml, type) → 타입별 텍스트
5. countWords(filteredContent, { language }) → WordCountResult
6. JSON 결과 반환 (본문 미포함)

복수 페이지:
- 각 페이지 독립 처리 → pages 배열
- 에러 없는 페이지들의 합산 → aggregate
```

### 반환값 (JSON → LLM)

LLM에는 구조화된 JSON을 반환하여 토큰을 최소화한다.
LLM이 이 데이터를 읽고 유저에게 자연어로 설명.

#### 복합 예시: 3개 페이지, 섹션 제외, 영어만

**유저**: "이 3개 페이지에서 부록 빼고 영어 단어 수 세줘"

**LLM Tool Call**:
```json
{
  "pageIds": ["https://xxx.atlassian.net/wiki/spaces/DEV/pages/123456", "789012", "345678"],
  "language": "english",
  "sections": ["부록"],
  "sectionMode": "exclude",
  "contentType": "all"
}
```

**Tool → LLM 반환값**:
```json
{
  "pages": [
    {
      "pageId": "123456",
      "totalWords": 1420,
      "breakdown": { "english": 1420, "korean": 0, "chinese": 0, "japanese": 0 }
    },
    {
      "pageId": "789012",
      "totalWords": 830,
      "breakdown": { "english": 830, "korean": 0, "chinese": 0, "japanese": 0 }
    },
    {
      "pageId": "345678",
      "totalWords": 0,
      "breakdown": { "english": 0, "korean": 0, "chinese": 0, "japanese": 0 },
      "error": "섹션 '부록'을 찾을 수 없습니다",
      "availableSections": ["개요", "API Reference", "변경 이력"]
    }
  ],
  "aggregate": {
    "totalWords": 2250,
    "breakdown": { "english": 2250, "korean": 0, "chinese": 0, "japanese": 0 }
  },
  "filters": {
    "language": "english",
    "sections": ["부록"],
    "sectionMode": "exclude",
    "contentType": "all"
  }
}
```

**LLM → 유저 응답**:
> 3개 페이지에서 부록을 제외한 영어 단어 수입니다:
> - 페이지 123456: 1,420 단어
> - 페이지 789012: 830 단어
> - 페이지 345678: "부록" 섹션이 없어 카운팅하지 못했습니다 (사용 가능 섹션: 개요, API Reference, 변경 이력)
>
> 합계: **2,250 단어**

#### 반환값 규칙

- `language` 필터 적용 시: `totalWords`는 해당 언어만 집계, `breakdown`에도 해당 언어만 비제로
- 단일 페이지: `aggregate` 생략
- 복수 페이지: `aggregate`는 에러 없는 페이지들만 합산
- 에러 페이지: `error` + `availableSections`(섹션 에러 시) 필드 추가, `totalWords: 0`

### 에러 처리

| 상황 | 반환값 |
|------|--------|
| 섹션 못 찾음 | 해당 page에 `"error"`, `"availableSections": [...]` |
| 콘텐츠 타입 없음 | `"totalWords": 0`, `"note": "지정한 콘텐츠 타입(tables)의 내용이 없습니다"` |
| MCP 호출 실패 | 해당 page에 `"error": "페이지를 가져올 수 없습니다: ..."` |

### 추가 사용 예시

```
유저: "이 페이지 영어 단어 수만 세줘"
LLM → { pageIds: ["123"], language: "english" }
반환 → { "pages": [{ "pageId":"123", "totalWords":1420, "breakdown":{"english":1420,...} }] }

유저: "API Reference 섹션의 테이블 안 영어 단어 수"
LLM → { pageIds: ["123"], language: "english", sections: ["API Reference"], sectionMode: "include", contentType: "tables" }
반환 → { "pages": [{ "pageId":"123", "totalWords":342, ... }] }

유저: "부록이랑 참고자료 빼고 전체 단어 수"
LLM → { pageIds: ["123"], sections: ["부록", "참고자료"], sectionMode: "exclude" }
반환 → { "pages": [{ "pageId":"123", "totalWords":5200, ... }] }

유저: "이 3개 URL 각각 한국어 단어 수 알려줘"
LLM → { pageIds: ["url1","url2","url3"], language: "korean" }
반환 → { "pages": [{...}, {...}, {...}], "aggregate": {"totalWords":2950,...} }
```

---

## File Changes

### NEW: `src/utils/htmlContentExtractor.ts`

HTML에서 콘텐츠 타입별 텍스트 추출. DOMParser 기반 (브라우저 네이티브).

**함수:**
- `extractContentByType(html, type: ContentType)` → 특정 타입 텍스트만 추출
  - `tables` → `<table>` 요소의 textContent
  - `lists` → `<ul>`, `<ol>` 요소의 textContent
  - `paragraphs` → `<p>` 요소의 textContent
  - `headings` → `<h1>`~`<h6>` 요소의 textContent
  - `all` → 원본 HTML 그대로 반환
- `extractSectionFromHtml(html, headingText)` → HTML heading 기반 단일 섹션 추출
  - `<h1>`~`<h6>` 매칭 → 동급/상위 heading에서 종료
- `filterSections(html, sections, mode)` → 다중 섹션 include/exclude 필터링
  - `mode: 'include'` → 지정 섹션들의 HTML만 합쳐서 반환
  - `mode: 'exclude'` → 지정 섹션들을 제거한 나머지 HTML 반환
- `listAvailableSections(html)` → 에러 시 사용 가능 섹션 목록 반환

### NEW: `src/utils/htmlContentExtractor.test.ts`

- `extractContentByType`: 각 타입별 추출 정확성, 빈 결과 처리
- `extractSectionFromHtml`: 섹션 추출, 중첩 섹션, 존재하지 않는 섹션, case-insensitive
- `filterSections`: include/exclude 모드, 복수 섹션, 존재하지 않는 섹션 에러
- `listAvailableSections`: 전체 헤딩 목록

### NEW: `src/ai/tools/confluenceTools.ts`

LangChain `tool()` 기반 `confluence_word_count` 정의.
- MCP fetch → HTML 파싱 → 섹션 필터링 → 콘텐츠 타입 필터링 → 카운팅 → JSON 반환
- 기존 `wordCounter.ts`의 `countWords`, `extractPageIdFromUrl` 재활용
- 반환: `JSON.stringify()` 구조화 데이터 (본문 미포함)

### MODIFY: `src/ai/mcp/McpClientManager.ts`

- **삭제**: lines 68-73 (`getConfluencePage` 응답에 단어 수 자동 첨부)
- **삭제**: `countWords`, `formatWordCountResult` import (line 6)
- `getConfluencePage`는 이제 순수 페이지 본문만 반환 (참고/인용 용도)

### MODIFY: `src/ai/chat.ts`

1. **Import**: `confluenceWordCountTool` from `confluenceTools`
2. **`streamAssistantReply()`** (~line 786): toolSpecs에 `confluenceWordCountTool` 추가
3. **`generateAssistantReply()`** (~line 660): MCP 도구 + `confluenceWordCountTool` 추가
4. **`buildToolGuideMessage()`** (~line 472): 프롬프트 업데이트
   - `getConfluencePage`: 내용 조회 (참고/인용)
   - `confluence_word_count`: 단어 수 전용 (★ 단어 수/분량 질문에는 반드시 이것 사용)
   - 파라미터 설명: sections/sectionMode로 섹션 포함/제외, contentType으로 콘텐츠 유형 필터

### MODIFY: `docs/trd/09-specialized.md`

9.3절 아키텍처를 새로운 전용 도구 방식으로 업데이트.

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| NEW | `src/utils/htmlContentExtractor.ts` | HTML 콘텐츠 타입별 추출 + 섹션 필터링 유틸리티 |
| NEW | `src/utils/htmlContentExtractor.test.ts` | 추출 유틸리티 테스트 |
| NEW | `src/ai/tools/confluenceTools.ts` | `confluence_word_count` LangChain 도구 |
| MODIFY | `src/ai/mcp/McpClientManager.ts` | auto-append 삭제 |
| MODIFY | `src/ai/chat.ts` | 도구 등록 + 프롬프트 |
| MODIFY | `docs/trd/09-specialized.md` | TRD 업데이트 |

---

## Key Design Decisions

1. **DOMParser 사용**: Regex 대신 브라우저 네이티브 DOMParser로 HTML 파싱. Confluence HTML의 복잡한 구조를 안정적으로 처리.

2. **HTML 섹션 추출 신규 작성**: 기존 `extractSection()`은 Markdown heading(`#`) 기반. Confluence는 HTML(`<h1>`~`<h6>`) 반환하므로 별도 함수 필요.

3. **MCP 클라이언트 재활용**: 새로운 API 호출 경로 없이 기존 `invoke('mcp_call_tool')` 사용. 인증도 기존 OAuth 흐름 그대로.

4. **에러 시 throw 안 함**: 에러 메시지를 JSON `error` 필드로 반환하여 LLM이 유저에게 자연스럽게 전달. 한 페이지 에러가 다른 페이지 처리를 막지 않음.

5. **getConfluencePage 역할 분리**: 본문 참고/인용 → `getConfluencePage`, 단어 수 → `confluence_word_count`. 각자 명확한 용도.

6. **JSON 반환**: 사람용 포맷 문자열 대신 구조화된 JSON 반환. 토큰 최소화 + LLM이 유저 질문에 맞춰 자연어로 재구성.

7. **섹션 include/exclude**: `sections` + `sectionMode` 조합으로 "이 섹션만" 또는 "이 섹션 빼고" 두 방향 모두 지원.

---

## Verification

1. **Unit Tests**: `npm run test:run` → htmlContentExtractor 테스트 통과
2. **Type Check**: `npx tsc --noEmit` → 에러 없음
3. **수동 테스트**:
   - "XX 페이지 단어 수" → `confluence_word_count` 호출, JSON 결과 확인
   - "XX 페이지 YY 섹션의 테이블 영어 단어만" → sections + contentType + language 파라미터 정상 전달
   - "부록 빼고 세줘" → sectionMode: "exclude" 정상 동작
   - "이 3개 URL 각각" → pages 배열 + aggregate 합산 확인
   - "XX 페이지 내용 보여줘" → `getConfluencePage` 호출 (본문만, 단어 수 미포함)

---

## Open Questions

- [ ] multi-page 지원 범위: `pageIds` 배열 최대 10개로 충분한지
- [ ] 콘텐츠 타입 추가 필요 여부: 'blockquotes', 'code' 등
- [ ] Confluence 매크로 처리: expand/collapse 내부 콘텐츠 포함 여부
- [x] 섹션 제외 모드 → `sections` + `sectionMode: 'exclude'`로 해결
- [x] 여러 URL 개별 결과 → `pageIds` 배열 + JSON `pages` 배열로 해결
- [x] 반환 포맷 → JSON 구조 (사람용 문자열 대신 구조화 데이터, 토큰 절약)
