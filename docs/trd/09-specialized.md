# 9. 특화 기능 명세 (Specialized Sub-systems)

## 9.1 Ghost Chips (태그 보호)

### What
- 특정 특수 문자나 태그(예: `<tag>`, `{var}`)가 번역 과정에서 손상되지 않도록 보호하기 위해 **Ghost Chips**를 사용합니다.
- `chatStore.ts`와 `ghostMask.ts`를 통해 모델 호출 전 마스킹하고, 응답 후 복원하는 과정을 거칩니다.

---

## 9.2 Smart Context Summarizer

### What
- 대화 토큰 임계치 모니터링과 Project Context 제안 UX는 점진 구현 중이며, Add to Rules / Add to Context 버튼을 통해 수동 반영합니다.

---

## 9.3 Confluence 단어 카운팅 (번역 분량 산정)

### Why
번역 프로젝트에서 분량 산정은 견적과 일정에 직접적 영향을 미칩니다.
Confluence 페이지의 실제 번역 대상 텍스트만 카운팅하여 정확한 분량 파악이 필요합니다.

### What
- **번역 불필요 콘텐츠 제외**: 코드 블록, 이미지, URL, 영상, 매크로
- **언어별 필터링**: 전체/영어/한국어/중국어/일본어/CJK
- **섹션별 카운팅**: 특정 Heading 포함/제외 필터링
- **콘텐츠 타입별 카운팅**: 표/리스트/본문/제목 필터링
- **여러 페이지 처리**: 복수 페이지 일괄 카운팅 + 총합

### How

#### 아키텍처 (v2 - 전용 도구 방식)

`confluence_word_count` 전용 도구로 단어 수만 계산하여 JSON 반환:

```
Before (v1):
  유저 → LLM → getConfluencePage → [본문 전체 + 단어 수] → LLM (수만 토큰) → 응답

After (v2):
  유저 → LLM → confluence_word_count({pageIds, language, sections, sectionMode, contentType})
             → 내부: MCP fetch → 프로그래밍 계산 → [JSON 수치만] → LLM (수백 토큰) → 응답
```

**토큰 절약**: 본문 전체가 LLM 컨텍스트에 들어가지 않음.

#### 도구 분리

| 도구 | 용도 |
|------|------|
| `getConfluencePage` | 페이지 내용 조회 (참고/인용 필요 시) |
| `confluence_word_count` | 단어 수 계산 (분량 산정) ★ 단어 수 질문에는 이것 사용 |

#### 파라미터

| 파라미터 | 설명 | 기본값 |
|---------|------|--------|
| `pageIds` | 페이지 ID 또는 URL 배열 (최대 10개) | 필수 |
| `language` | 언어 필터 (all/english/korean/chinese/japanese/cjk) | all |
| `sections` | 필터링할 섹션 제목 배열 | - |
| `sectionMode` | include=지정 섹션만, exclude=지정 섹션 제외 | include |
| `contentType` | all/tables/lists/paragraphs/headings | all |
| `excludeTechnical` | 기술 식별자 제외 (파일명, 확장자, 약어, 숫자+단위 등) | true |

#### 반환 형식 (JSON)

```json
{
  "pages": [
    {
      "pageId": "123456",
      "totalWords": 1420,
      "breakdown": { "english": 1420, "korean": 0, "chinese": 0, "japanese": 0 }
    }
  ],
  "aggregate": {
    "totalWords": 1420,
    "breakdown": { "english": 1420, "korean": 0, "chinese": 0, "japanese": 0 }
  },
  "filters": {
    "language": "english",
    "sections": ["부록"],
    "sectionMode": "exclude",
    "contentType": "all",
    "excludeTechnical": true
  }
}
```

#### 에러 처리

| 상황 | 반환값 |
|------|--------|
| 섹션 못 찾음 | 해당 page에 `"error"`, `"availableSections": [...]` |
| 콘텐츠 타입 없음 | `"totalWords": 0`, `"note": "지정한 콘텐츠 타입(tables)의 내용이 없습니다"` |
| MCP 호출 실패 | 해당 page에 `"error": "페이지를 가져올 수 없습니다: ..."` |

#### 사용 시나리오

| 시나리오 | LLM Tool Call 예시 |
|---------|-------------------|
| 단일 페이지 전체 | `{ pageIds: ["123"], language: "all" }` |
| 영어만 | `{ pageIds: ["123"], language: "english" }` |
| 부록 제외 | `{ pageIds: ["123"], sections: ["부록"], sectionMode: "exclude" }` |
| 특정 섹션만 | `{ pageIds: ["123"], sections: ["API Reference"], sectionMode: "include" }` |
| 테이블만 | `{ pageIds: ["123"], contentType: "tables" }` |
| 복수 페이지 | `{ pageIds: ["url1", "url2", "url3"], language: "korean" }` |
| 기술문서(파일명 포함) | `{ pageIds: ["123"], excludeTechnical: false }` |

### 구현 파일

| 파일 | 설명 |
|------|------|
| `src/utils/wordCounter.ts` | 핵심 단어 카운팅 로직 (순수 함수) |
| `src/utils/htmlContentExtractor.ts` | HTML 콘텐츠 타입별 추출 + 섹션 필터링 |
| `src/ai/tools/confluenceTools.ts` | `confluence_word_count` LangChain 도구 |
| `src/ai/chat.ts` | 도구 등록 + 프롬프트 가이드 |

### 비단어 토큰 필터링 (`excludeTechnical: true`, MS Word 스타일)

MS Word처럼 단순하게 순수 숫자와 기호만 제외:

| 제외 | 예시 |
|------|------|
| 순수 숫자 | `2025`, `4096`, `0.5` |
| 순수 기호 | `/`, `->`, `&`, `→`, `x` |

| 포함 (단어로 카운트) | 예시 |
|---------------------|------|
| 기술 용어 | `3ds`, `UV`, `FBX`, `RGBA` |
| 파일 확장자 | `.max`, `.fbx`, `.tga` |
| 파일명 | `Spur.Max`, `SK_Spur.fbx` |
| 숫자+단위 | `70K`, `4096x4096` |

### 제한사항

1. **MCP 연결 필수**: Confluence 미연결 시 사용 불가
2. **페이지 수 제한**: 한 번에 최대 10개 페이지
3. **HTML 기반 섹션 필터링**: Confluence HTML의 `<h1>`~`<h6>` 태그 기반
