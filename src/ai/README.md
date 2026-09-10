## AI 폴더 개요 (`src/ai/`)

이 폴더는 **채팅(질문/검수)** 및 **번역(Preview→Apply)**에 사용되는 AI 로직과, 모델이 필요 시 호출하는 **tool(도구)**들을 포함합니다.

핵심 원칙:
- **Non-Intrusive**: AI는 사용자 요청 시에만 응답합니다.
- **문서 자동 변경 금지**: 채팅은 번역문/문서를 자동으로 수정하지 않습니다.
- **저장/메모리 자동 반영 금지**: 규칙/컨텍스트는 **AI가 직접 저장할 수 없고**, UI에 표시되는 **버튼을 사용자가 클릭**해야만 반영됩니다.

---

## 모드 구분

### 1) Chat (질문/검수)
- 사용자 입력을 `prompt.ts`에서 `requestType='question'`으로 처리합니다.  
- 번역 생성(전체 번역/리라이트)은 채팅에서 금지이며, 필요 시 **Translate(Preview) 워크플로우**로 유도합니다.
- 원문/번역문 **대조/검수(정확성 확인, 누락/오역, 고유명사/기관명 등)**가 필요하면, 사용자가 문서를 붙여주길 기다리기 전에 **문서 도구(tool)**를 on-demand로 호출해 근거를 확보합니다.

### 2) Translate (Preview→Apply)
- 전체 문서 번역은 `translateDocument.ts`가 담당합니다.
- 모델 출력은 `---TRANSLATION_START/END---` 마커 사이의 **Markdown**이고, 파싱 후 TipTap JSON으로 변환해
  UI에서 Preview 후 Apply로 반영합니다 ([ADR-0002](../../docs/adr/0002-tiptap-json-as-canonical-format.md)).
  저장 포맷이 TipTap JSON이고 모델 왕복은 Markdown입니다 — 둘을 섞지 마세요.

---

## 프롬프트/컨텍스트 구성 (`prompt.ts`)

`buildLangChainMessages()`가 시스템 프롬프트 + 시스템 컨텍스트를 조립합니다.

포함 가능한 컨텍스트:
- Translation Rules (사용자 입력)
- Glossary Injected (로컬 글로서리 검색 결과)
- Project Context (사용자 입력/요약)
- Source/Target 문서(채팅에서는 기본 payload에 인라인으로 넣지 않고 tool로 조회)
- 컨텍스트 블록(선택 블록)

토큰(문자) 최적화:
- Translation Rules / Context Blocks는 **상한을 두어**(문자 길이) 과도한 컨텍스트 폭증을 방지합니다.

---

## Tool Calling 동작 (`chat.ts`)

### Tool calling loop
`streamAssistantReply()` → `chatAgent/`의 LangGraph agent가 다음을 반복합니다:
1) 모델 호출
2) 응답에 tool_calls가 있으면 해당 tool 실행
3) tool 결과를 ToolMessage로 추가
4) tool_calls가 없으면 최종 답변으로 종료

기본 최대 step은 제한되어 있습니다(무한 루프 방지). 마지막 스텝에는 `FINAL_STEP_NUDGE`가 주입됩니다
(`chatAgent/middleware.ts`). 외부 도구(`trust: 'external'`)와 registry 미등록 도구의 출력은 같은
미들웨어가 `<external_content>`로 감쌉니다.

### Tool guide (system message)
모델이 도구 사용 원칙을 잊지 않도록, 시스템 메시지로 간단한 도구 가이드를 주입합니다.

---

## 프롬프트/지침 중복 리스크(드리프트) 줄이기: 단일 Source of Truth

이 프로젝트에서 **"어떤 지식을 어느 도구에 넣는가"의 정의는 한 곳에만 둡니다.**

- **Source of Truth(정의의 기준)**: `chat.ts`의 `buildToolGuideMessage()` 안에 있는
  **저장 제안 도구 4분류 블록**
  - 용어집 / 금칙어 / 번역 규칙 / 프로젝트 메모리를 한 자리에서 갈라 줍니다.
  - 도구 description에 흩어 두면 4곳이 따로 낡습니다. 잘못 고르면 비용이 도구 하나로 끝나지
    않기 때문에(용어집·금칙어는 문서에 나올 때만 실리지만, 규칙·메모리는 블롭이라 이후 **모든**
    번역·검수에 전량 실립니다) 선택 기준을 한 덩어리로 보여 주는 편이 낫습니다.
  - 2026-09-03 프롬프트 감사에서 확정. 종전 문서는 `tools/suggestionTools.ts`를 기준으로
    적어 두었으나 실물은 이미 도구 가이드로 옮겨져 있었습니다.

- **Secondary(최소 지침)**: 각 도구의 `description` + `prompt.ts`의 system message
  - 도구 description은 그 도구가 **무엇을 저장 제안하는지**와 "승인 전에는 저장하지 않는다"까지.
  - system message는 중복 정의/예시를 넣지 않고 UX 안전장치만 둡니다.
  - 안전장치 예:
    - `suggest_*`는 저장이 아니라 **저장 제안 생성**임
    - 응답에서 “저장/추가 완료” 금지
    - 필요 시 “원하시면 [Add to Rules]/[Add to Context] 버튼…” 안내

왜 이렇게 하나요?
- 같은 규칙을 여러 곳에 반복하면, 시간이 지나면서 한 군데만 업데이트되어 **모델이 서로 다른 지침을 동시에 받는**(드리프트/충돌) 문제가 생길 수 있습니다.
- 반대로 정의를 1곳에만 두면, 업데이트 포인트가 명확해져 유지보수가 안정됩니다.

---

## 제공 도구 목록

### 1) 문서 조회 도구 (`tools/documentTools.ts`)
- `get_source_document`
- `get_target_document`

정책:
- **질문/검수에 꼭 필요할 때만** 호출합니다. 단, **대조/검수 요청**이라면 먼저 호출하는 것이 원칙입니다.
- 문서가 아주 긴 경우 토큰 폭발을 막기 위해 **자동으로 일부만 반환될 수 있습니다**(auto truncate).
- (옵션) 문서가 길고 특정 구절 근처가 필요하면 `query` / `maxChars` / `aroundChars`를 전달해 **해당 구절 주변만 발췌**를 유도할 수 있습니다.

### 2) 저장 제안 도구 (`tools/suggestionTools.ts`, `tools/proposalTools.ts`)
- `suggest_translation_rule` (문체·서식·표기 규칙)
- `suggest_glossary_entry` (원문 A → 번역 B 고정)
- `suggest_forbidden_term` (번역문에 쓰면 안 되는 표현)
- `propose_project_memory_change` (제품·독자·세계관 같은 배경 사실)

`suggest_project_context`는 [ADR-0004](../../docs/adr/0004-approval-based-project-memory.md)에서
`propose_project_memory_change`로 대체되어 더 이상 없습니다.

정책(중요):
- 이 도구들은 **저장을 수행하지 않습니다.**
- 오직 **“저장 제안(suggestion) 생성”** 신호만 만들고,
  실제 반영은 UI에 표시된 버튼을 **사용자가 클릭**해야만 일어납니다.

AI 응답 문구 가이드:
- 금지: “저장했습니다 / 추가했습니다”
- 권장: “저장 제안을 생성했습니다. 원하시면 버튼을 눌러 추가하세요.”

### Translation Rules vs Project Memory (구분 정의 위치)
- **4분류 정의는 `chat.ts`의 `buildToolGuideMessage()`에만** 둡니다. (단일 Source of Truth)
- `prompt.ts`와 각 도구 description은 중복 정의를 피하고, 버튼 안내 같은 최소 지침만 유지합니다.

---

## UI 연동(요약)

채팅 UI는 tool 호출 이벤트를 받아:
- `suggest_*` 호출 시, 메시지 메타데이터에 suggestion 내용을 기록
- UI에서 “Add to Rules / Add to Context” 같은 버튼을 표시
- 사용자가 클릭하면 실제 `Translation Rules`/`Project Context`에 append

추가 폴백:
- 모델이 `suggest_*` tool을 호출하지 않더라도, assistant 응답에
  “원하시면 버튼을 눌러 번역 규칙(또는 Project Context)으로 추가하세요” 같은 문구가 포함되면,
  UI가 해당 메시지를 **저장 제안(suggestion)으로 추론**하여 버튼을 표시할 수 있습니다.

---

## 디버깅 팁

- 문서/글로서리/규칙이 길어질수록 비용이 커지므로, 필요할 때만 컨텍스트를 선택/주입하는 쪽이 유리합니다.
- 문서 비교가 필요 없는 일반 질문은 도구 호출 없이 답하도록 가이드되어 있습니다.


