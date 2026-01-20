# 3. AI 상호작용 및 Preview 워크플로우

## 3.1 문서 전체 번역 (Preview → Apply)

### Why
- HTML/서식 손상 없이 번역문을 적용하려면 Preview 후 사용자가 명시적으로 Apply 해야 합니다.
- **Markdown 중간 형식**을 사용하여 토큰 효율성을 높이고, 청킹 복잡도를 낮춥니다.

### How
- Translate 버튼/단축키로 Source 전체를 **Markdown으로 변환**하여 모델에 전달하고, 출력도 **Markdown**으로 받습니다.
- 응답 Markdown을 TipTap JSON으로 변환하여 Preview 모달에서 원문-번역 Diff를 보여주고, Apply 시 Target을 전체 덮어쓰기 합니다.
- 문서 전체 번역(Translate)은 채팅 히스토리를 컨텍스트에 포함하지 않습니다. (Settings의 페르소나/번역 규칙/Project Context/글로서리/문서 컨텍스트만 사용)

### What
- **Trigger**: Translate(Preview) 버튼/단축키
- **Input**: Source 문서를 **Markdown으로 변환** + project meta(targetLanguage/domain), translationRules, projectContext, translatorPersona, glossary/attachments(있는 경우)
- **Output**: **Markdown** (문서 전체) → TipTap JSON으로 변환 후 Preview 표시
- **UX**: Preview 모달(Preview/Diff), Apply 시 전체 덮어쓰기. 자동 적용 없음. **에러 시 Retry 버튼 표시**.
- **API 구조**: LangChain `BaseMessage[]` 배열
  - SystemMessage 1개: 번역 전용 프롬프트 (페르소나, 번역 규칙, Project Context 포함)
  - UserMessage 1개: **Markdown 문서**를 문자열로 전달
  - 히스토리 메시지 없음

### Markdown 변환 파이프라인
- **TipTap → Markdown**: `tiptap-markdown` extension 사용 (`editor.storage.markdown.getMarkdown()`)
- **Markdown → TipTap**: `tiptap-markdown` extension 사용 (`editor.commands.setContent(markdown)`)
- **지원 서식**: Headings, Bold, Italic, Strike, Lists (중첩), Blockquote (중첩), CodeBlock, Link, Table, HorizontalRule
- **손실 가능 항목**: 링크의 `target` 속성, 복잡한 테이블(colspan/rowspan) - 번역에 영향 없음

### 출력 안정성
- **구분자 사용**: `---TRANSLATION_START---` / `---TRANSLATION_END---`로 번역 결과 구분
- **후처리**: 구분자 사이 내용만 추출, 없으면 전체 응답 사용 (경고 로그)
- **Truncation 감지**: 열린 코드블록(홀수 ` ``` `), 문서 끝 미완성 링크 체크 (보수적 판단으로 오탐 방지)
- **finish_reason 검사**: `length`인 경우 토큰 제한 에러로 처리

### 동적 max_tokens 계산
- 입력 문서 크기 기반으로 출력 토큰 자동 계산 (JSON 오버헤드 없이 순수 텍스트 기준)
- GPT-5 400k 컨텍스트 윈도우 기준, 안전 마진 10%
- 문서가 너무 큰 경우 **Context-aware 청킹**으로 분할 번역 (코드블록/리스트 내부 분할 금지)

### 이미지 플레이스홀더 시스템
- **목적**: Base64 이미지(수만 토큰)를 플레이스홀더로 대체하여 토큰 절약
- **처리 흐름**: Markdown → `extractImages()` → 번역 → `restoreImages()` → TipTap JSON
- **토큰 절약**: Base64 50KB 기준 ~16,500 토큰 → 1-2 토큰 (99.99% 절약)
- **구현 파일**: `src/utils/imagePlaceholder.ts`

---

## 3.2 Context Collection 명세 (Payload 규칙)

### Why
- 번역/질문 시 원문 컨텍스트와 규칙을 일관되게 전달해야 품질을 유지할 수 있습니다.

### How
- UI 트리거 시 프로젝트/문서 상태에서 컨텍스트를 조립해 모델 payload에 포함합니다.
- 단, 토큰 최적화를 위해 Question(채팅) 모드에서는 "초기 호출"에 문서 전체를 항상 포함하지 않을 수 있으며, 필요 시 Agent/Tool(문서 조회 도구)로 on-demand로 불러옵니다.

### What (의도/행동 정의)
- **Add to chat**: 채팅 입력창에 텍스트 추가(모델 호출 없음)
- **Translate 요청**: 문서 전체 번역(Preview → Apply)
- **Question 요청**: 질의/검수(모델 호출), 문서 자동 적용 없음

### What (Payload 구성 규칙: 우선순위)
- **반드시 포함**: 프로젝트 메타(targetLanguage/domain), Translation Rules(번역 규칙), Project Context(맥락 정보)
- **가능하면 포함(권장)**: 선택 텍스트(가능하면) + 주변 문맥(before/after) + 선택이 없으면 필요한 범위의 문서(부분/전체)
- **Question(채팅) 모드**: 문서(Source/Target)는 "항상" 초기 payload에 포함하지 않아도 되며, 아래 원칙을 따른다.
  - 목표: 불필요한 토큰 소비를 줄이고, 문맥이 필요한 질문에만 문서를 제공한다.
  - 방법: 모델이 필요하다고 판단하면 문서 조회 Tool을 호출하여 원문/번역문을 on-demand로 가져온다.
  - 보호(단순화): 현재는 Source/Target 접근 토글을 제공하지 않으며, 문서 조회는 on-demand Tool 호출로만 수행한다.
- **조건부 포함**: Glossary/첨부, before/after 문맥
- **질문(Question) 모드에서만 포함**: 최근 메시지 (기본 20개, `VITE_AI_MAX_RECENT_MESSAGES` 환경변수로 조정 가능)
- **출력 포맷 강제**:
  - Translate: **Markdown 전체만 출력**(설명 금지, `---TRANSLATION_START/END---` 구분자 사용)
  - Question/검수: 간결한 답변 또는 JSON 리포트(필요 시)

### 컨텍스트 길이 제한 (GPT-5 시리즈 400k 컨텍스트 윈도우 기준)
| 항목 | 최대 길이 |
|------|-----------|
| Translation Rules | 10,000자 |
| Project Context | 30,000자 |
| Glossary | 30,000자 |
| Source/Target Document | 100,000자 (채팅 모드에서는 on-demand tool 호출) |
| 첨부파일 (개별) | 30,000자 |
| 첨부파일 (총합) | 100,000자 |
| 채팅 이미지 | 최대 10장, 이미지당 10MB |
| Context Blocks | 최대 20개 블록, 블록당 최대 500자 |
| 출력 토큰 (번역 모드) | 최대 65,536 토큰 |

### What (API 구조 - 채팅 모드)
- LangChain `BaseMessage[]` 배열 사용
- ChatPromptTemplate으로 메시지 구성:
  - SystemMessage 1개: 요청 유형별 시스템 프롬프트 (translate/question/general)
  - SystemMessage 1개 (조건부): SystemContext (번역 규칙/Project Context/글로서리/문서/컨텍스트 블록)
  - SystemMessage 1개: Tool Guide (문서 조회 도구 및 제안 도구 사용 가이드)
  - MessagesPlaceholder: 히스토리 메시지 (question 모드에서만 최근 10개)
  - HumanMessage 1개: 사용자 입력

### Tool Calling 지원 (적극적 도구 사용 정책)
- `get_source_document`: 원문 문서 조회 (**Markdown 형식 반환**) - 문서 관련 질문 시 먼저 호출 권장
- `get_target_document`: 번역문 문서 조회 (**Markdown 형식 반환**) - 번역 품질/표현 질문 시 먼저 호출 권장
- `suggest_translation_rule`: 번역 규칙 제안
- `suggest_project_context`: Project Context 제안

### 문서 조회 도구 Markdown 변환
- TipTap JSON이 있으면 `tipTapJsonToMarkdown()`으로 변환하여 서식 보존
- 서식(헤딩, 리스트, 볼드, 이탤릭, 링크 등)이 Markdown으로 표현됨
- 변환 실패 시 plain text fallback (stripHtml)
- **TipTap JSON 초기화**: 프로젝트 로드 시점에 `sourceDocJson`/`targetDocJson`을 `htmlToTipTapJson()`으로 초기화하여 에디터 마운트 전에도 도구 접근 보장 (Focus Mode 대응)

### Tool Calling Loop 설정
- maxSteps 기본값: 6 (이전: 4), 최대값: 12 (이전: 8)
- 복합 쿼리 시 충분한 도구 호출 허용

### 채팅에서 지원하는 기능
- **부분 번역**: 특정 문장, 단락, 선택 영역의 번역 요청
- **여러 버전 제안**: "A안/B안", "격식체/비격식체", "직역/의역" 등 대안 제시
- **부분 검수**: 특정 구간의 오역/누락/왜곡 검토
- **번역 개선**: 특정 문장의 다듬기, 자연스러운 표현 제안
- **전체 문서 번역**: 문서 전체 번역 요청도 채팅에서 처리 가능 (Tool Calling으로 문서 접근)
- **전체 문서 검수**: 문서 전체 검수 요청도 채팅에서 처리 가능

**참고**: 전체 문서 번역은 **Translate 버튼**으로, 체계적 검수는 **Review 탭**으로도 수행 가능 (버튼 사용이 더 효율적)

### 외부 참조 도구 (조건부)
Confluence 문서 검색/가져오기: Rovo MCP `search()` / `fetch()`
- **Rust 네이티브 SSE 클라이언트**: Node.js 의존성 없이 Rust에서 직접 Atlassian MCP 서버에 SSE 연결.
- OAuth 2.1 PKCE 인증도 Rust에서 네이티브로 처리 (로컬 콜백 서버 방식).
- 사용자는 Chat 탭에서 `Confluence_search` 토글로 사용 여부를 제어한다(3.6 참조).
- 토글이 꺼져 있으면 모델에 도구를 바인딩/노출하지 않는다(웹검색 게이트와 동일 원칙).
- **SSE 연결 리소스 관리**:
  - 엔드포인트 수신 타임아웃(10초) 시 shutdown signal로 백그라운드 SSE 태스크 종료
  - 연결 실패/타임아웃 시 리소스 누수 방지

---

## 3.3 실시간 토큰 스트리밍 (Real-time Token Streaming)

### Why
- 번역가는 AI 응답을 기다리는 동안 불안감을 느끼며, 첫 토큰이 빠르게 표시될수록 "응답이 진행 중"임을 인지합니다.
- Claude App과 같은 실시간 타이핑 효과는 사용자 체감 응답성을 대폭 향상시킵니다.

### How
- LangChain `.stream()` API를 사용하여 토큰별로 실시간 수신
- 각 토큰을 즉시 UI 콜백(`onToken`)으로 전달
- 도구 호출 청크(`tool_call_chunks`)를 수집하여 완성된 도구 호출로 병합

### What
- **스트리밍 구현 위치**: `src/ai/chat.ts` → `runToolCallingLoop()` 함수
- **응답 흐름**:
  ```
  .stream() → for await (chunk) {
    - 텍스트 토큰: 즉시 onToken 콜백 호출
    - 도구 호출 청크: 수집 후 병합
    - 최종 메시지: concat으로 누적
  }
  ```
- **첫 토큰 표시 시간**: 0.5~2초 (이전 의사-스트리밍: 5~30초)
- **도구 호출 중 상태 표시**: `onToolCall` 콜백으로 진행 상태 전달
- **요청 취소**: 기존 `AbortSignal` 패턴 유지
- **네트워크 에러 시**: 부분 응답 반환 (토큰 손실 방지)

---

## 3.4 스트리밍 번역 (Streaming Translation)

### Why
- 번역 결과를 기다리는 동안 사용자에게 진행 상황을 실시간으로 보여줍니다.
- Preview 모달에서 번역 텍스트가 타이핑되는 효과를 제공합니다.

### How
- LangChain `.stream()` API를 사용하여 토큰별로 실시간 수신
- `onToken` 콜백으로 누적된 텍스트를 UI에 전달
- 완료 후 Markdown → TipTap JSON 변환

### What
- **스트리밍 구현 위치**: `src/ai/translateDocument.ts` → `translateWithStreaming()` 함수
- Markdown 파이프라인과 동일: Source → Markdown → LLM (streaming) → Markdown → TipTap JSON
- **응답 흐름**:
  ```
  .stream() → for await (chunk) {
    - 텍스트 토큰: 누적 후 onToken 콜백 호출
    - 완료 시: extractTranslationMarkdown() → markdownToTipTapJson()
  }
  ```
- **구분자 추출**: `---TRANSLATION_START/END---` 마커 사용
- **Truncation 감지**: 완료 후 Markdown 구조 검증

---

## 3.5 Selection/Context 매핑 (TipTap 기반)

### Why
- 선택/문서 컨텍스트를 안정적으로 주입해 일관된 응답을 받기 위함입니다.

### How
- TipTap 문서에서 선택 텍스트를 추출(Cmd+L)하고, Source/Target 전체 텍스트를 필요 시 포함합니다.

### What (fallback 규칙)
- 선택 추출이 실패해도 최소한 Source/Target 전체 또는 번역 규칙/Project Context는 포함합니다.

---

## 3.6 편집 적용 정책

### What
- 모델 응답이 문서를 자동으로 변경하지 않습니다.
- 문서 전체 번역은 Preview 후 사용자가 Apply할 때만 Target에 반영됩니다.
- Diff/Keep/Discard, Pending Edit 세션, diff-match-patch 기반 워크플로우는 사용하지 않습니다.

---

## 3.7 워크플로우(사용자 여정) 기반 기술 요구사항

### Why
- 실제 사용 흐름(붙여넣기 → 참조 투입 → 번역 요청 → 비교/수정 → 질의 세션 분리 → 적용 결정)을 그대로 지원해야 제품이 "Cursor AI 방식의 번역 경험"이 됩니다.

### What

#### 원문 붙여넣기
- SourceDocument는 참조 전용이며, 프로젝트에 저장되고 항상 AI 컨텍스트로 주입 가능해야 함

#### 설정(Settings)/참조 문서(글로서리 등)
- AI 채팅 패널에는 "Settings" 화면이 존재하며, 여기에서 사용자 편집 가능한 설정을 관리한다.
- **Settings 항목(최소)**: 시스템 프롬프트 오버레이(System Prompt Overlay), 번역 규칙(Translation Rules), Project Context, 첨부 파일(참조문서/글로서리)
- 시스템 프롬프트 오버레이는 모델 호출 시 system 메시지에 반영된다.
- **번역 규칙(Translation Rules)**: 포맷, 서식, 문체 등 번역에 적용되는 규칙 (예: "해요체 사용", "따옴표 유지", "고유명사는 음차")
- **Project Context**: 번역 시 참고할만한 추가 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)
- 글로서리 주입은 비벡터(임베딩/벡터화 없음)로 한다.

#### 멀티 채팅 세션
- "번역 작업 세션"과 "개념 질의 세션"을 분리할 수 있어야 함
- 세션별로 Project Context(요약)와 첨부 컨텍스트 상태(선택/블록/참조문서 범위)를 관리

#### 선택 → 재수정
- Add to chat은 "텍스트 추가" UX로 유지
- Edit 요청은 반드시 원문/번역 자동 주입이 보장되어야 함(3.2~3.3)

#### 적용 결정(반영/미반영)
- 모든 편집 제안은 항상 Diff Preview를 거치며, Keep/Discard의 결과가 저장/히스토리와 정합해야 함

#### 저장/재개
- `.ite` 프로젝트 파일에 `blocks/segments/채팅 세션/참조 문서/요약 메모리`가 함께 저장되어 재개 시 그대로 복원되어야 함
