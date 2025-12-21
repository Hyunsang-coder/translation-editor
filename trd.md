🛠 [TRD] Integrated Translation Editor (ITE) Technical Specifications

이 문서는 ITE의 **기술 설계도(Source of Truth)**입니다. 구현/문서가 충돌하면 본 문서를 기준으로 정리합니다.

표기 규칙:
- **Why**: 왜 필요한가(의도/리스크)
- **How**: 어떻게 구현할까(접근/전략)
- **What**: 정확히 무엇을 만든다(명세/규칙)
1. 아키텍처 개요 (System Architecture)
1.1 기반 기술 (The Dual-Core Approach)
Why:
- 전문 번역가는 대용량 텍스트를 다루며, 실시간 AI 응답을 검토/수락/거절하는 고부하 작업을 수행합니다.
- Electron 대비 리소스가 가볍고 네이티브 접근이 강력한 Tauri, 그리고 에디터 성능이 검증된 Monaco 조합이 유리합니다.

How:
- Backend (Rust): 파일 시스템 제어, SQLite DB 관리, 외부 도구(Sidecar) 실행
- Frontend (React + TS): UI 렌더링, Monaco 인스턴스 관리, 상태 관리(Zustand)

What:
- SQLite 기반 단일 `.ite` 프로젝트 파일을 지원하는 네이티브 데스크톱 애플리케이션

2. 에디터 엔진 설계 (Editor Engine: Monaco)
2.1 Target Pane 커스터마이징 (Document Mode)
Why:
- Monaco는 기본적으로 코딩용이지만, 번역가는 텍스트 가독성을 최우선으로 합니다.

How:
- 에디터 생성 시 `IEditorConstructionOptions`를 문서 편집 감성에 맞게 튜닝합니다.

What (권장 옵션):
- `fontFamily`: `Pretendard`
- `fontSize`: 16px
- `lineHeight`: 1.8
- `lineNumbers`: off
- `minimap`: off
- `glyphMargin`: false
- `wordWrap`: on
- `renderLineHighlight`: none

2.2 Range-based Tracking (수정 범위 추적)
Why:
- AI가 번역문을 수정하는 동안 사용자가 다른 곳을 편집해도, 제안이 **정확한 위치**에 적용되어야 합니다.

How:
- Monaco의 tracked range(`ITrackedRange`/decoration stickiness)를 사용해 범위를 ID로 추적합니다.

What:
- 문서 앞/뒤에 텍스트가 삽입되어도 상대 좌표가 유지되는 범위 추적 로직

3. AI 상호작용 및 Diff 엔진 (AI Interaction & Diff)
3.1 Cursor 스타일 편집 워크플로우(개요)
Why:
- 전체 문장을 갈아끼우는 방식은 위험합니다. Cursor처럼 **바뀐 부분만** 시각화하고, 사용자가 “유지/폐기”를 결정하는 경험이 생산성의 핵심입니다.
- 번역 도메인에서도 동일하게 “편집 제안(Pending Edit) → Diff Preview → Keep/Discard” 흐름을 일관되게 제공합니다.

How:
- Context Collection: 선택 영역 + 원문 맥락 + (가능하면) 용어집/참조 문서를 조립해 LLM에 전달
- Streaming: `fetch` + `ReadableStream`으로 응답을 스트리밍 수신(선택)
- Diff Calculation: `diff-match-patch`로 글자 단위 델타를 계산해 시각화

What:
- **Pending Edit(편집 세션)** 생성: 모델 응답을 즉시 본문에 확정하지 않고 “대기 상태 제안”으로 보관
- Diff Preview: 적용 전 Diff 시각화(추가=초록, 삭제=빨강)
- Keep/Discard: 사용자가 제안을 유지(확정) 또는 폐기
- In-place Preview: 실제 텍스트 확정 전 “미리보기 상태” 제공

3.2 Context Collection 명세 (Payload 규칙)
Why:
- 사용자가 “Add to chat”을 눌렀는데 AI가 원문/번역을 모르거나 다시 붙여달라고 요구하면 Document-First 흐름이 끊깁니다.
- 이 상태에서는 Apply/Diff 테스트가 사실상 불가능해집니다.

How:
- UI 트리거(단축키/버튼)는 이벤트만 발생시키고 끝나면 안 됩니다.
- 반드시 프로젝트/문서 상태에서 컨텍스트를 조립하여 모델 호출(payload)에 포함합니다.

What (의도/행동 정의):
- Add to chat: 채팅 입력창(composer)에 텍스트를 추가하는 보조 UX (모델 호출 없음)
- Edit 요청: 선택 범위 또는 문서 구간을 교정/재작성하기 위한 모델 호출 (Pending Edit 생성)
- Translate 요청: 원문을 번역문으로 생성하기 위한 모델 호출 (초기 번역/재번역)

What (2-step Orchestration: Router → Executor):
- 목표: “사용자 요구에 따라” 모델 호출/툴 실행의 형태가 달라져도 UX/안정성이 흔들리지 않게, 모든 요청을 2단계로 고정한다.
- 1단계 Router(Intent Routing):
  - 입력: 사용자 메시지 + 현재 편집 상태(선택 영역 존재 여부, includeSource/includeTarget, 프로젝트 메타 등)
  - 출력: `taskType` (아래 중 1개로 고정)
    - `edit_selection`: 선택 구간 교정/재작성(범위 기반)
    - `edit_document`: 번역문 전체(또는 큰 구간) 제안(전체 기반)
    - `translate_document`: 원문→번역문 생성(전체 번역)
    - `check_target`: 번역문 단독 검수/오탈자 체크(리포트)
    - `check_compare`: 원문-번역 비교 검수(리포트)
  - 구현 전략: 1차는 룰/키워드(예: “오탈자/검수/비교/전반/문체/전체”) + 선택 여부로 결정하고, 필요 시에만 “짧은 JSON 라우터(LLM)”로 대체 가능.
- 2단계 Executor(Execution):
  - Router의 `taskType`에 따라 서로 다른 Prompt/Output Contract를 적용한다.
  - `edit_selection`: 출력은 “선택 구간의 대체 텍스트만” (설명/불릿/따옴표/마크다운 금지) → Pending Edit 생성 → Diff Preview → Keep/Discard
  - `translate_document`: 출력은 “번역문 전체만” (설명 금지) → Pending Edit 생성(초기 번역도 동일) → Diff Preview → Keep/Discard
  - `edit_document`: 출력은 “번역문 전체(또는 지정 구간)만” (설명 금지) → Pending Edit 생성 → Diff Preview → Keep/Discard
  - `check_target`/`check_compare`: 출력은 “JSON 리포트만” (설명/마크다운 금지). 기본 결과는 리포트이며 문서를 자동 변경하지 않는다. (적용은 별도 명시 요청 시 `edit_*`로 전환)

What (Payload 구성 규칙: 우선순위):
- **반드시 포함**
  - 프로젝트 메타: `sourceLanguage`, `targetLanguage`, `domain`
  - 대상 텍스트: `selectionText` 또는 전체(`targetDocument` 또는 `target blocks`)
  - 원문 컨텍스트: `source blocks`(또는 `sourceDocument` 일부) — PRD 원칙상 “항상 최우선 맥락”
- **조건부 포함**
  - 선택 주변 문맥: `beforeText`/`afterText`(offset 기반일 때)
  - 참조 문서/글로서리: `glossary`/`snippets`(사용자가 추가한 경우)
    - 글로서리는 “업로드한 파일을 로컬에서 직접 읽기(필요 시 SQLite로 임포트)”를 기본으로 한다.
    - 관련 용어 추출은 텍스트 기반 검색(룰/FTS 등)으로 수행하며, 임베딩/벡터화는 하지 않는다.
  - Active Memory(용어/톤 규칙 요약): summarizer 결과(임계치 도달 시)

What (모델 출력 포맷 강제):
- Edit 요청(선택 범위): 출력은 “선택 구간의 대체 텍스트만” (설명/불릿/따옴표/마크다운 금지)
- Translate 요청: 출력은 “번역문 전체만” (설명 금지)
- Check 요청(오탈자/검수): 출력은 “JSON 리포트만” (설명/마크다운 금지)

3.3 Selection(Offset) → Segment/Block 매핑 규칙 (Range 기반)
Why:
- 단일 문서(TargetDocument)에서 선택한 범위를, N:M `blocks/segments` 모델과 안전하게 연결해야 원문/번역 컨텍스트를 자동으로 주입할 수 있습니다.

How:
- Target Monaco 편집 모델에 `blocks`의 tracked range를 유지합니다.
- selection range(offset)를 “어떤 target block(들)”에 속하는지 판별한 뒤, segmentGroup을 역으로 찾습니다.

What (매핑 알고리즘: 권장):
1) `selectionStartOffset` / `selectionEndOffset`를 취득한다.
2) tracked ranges로부터 `blockRanges[blockId] = { startOffset, endOffset }`를 얻는다.
3) selection과 겹치는 target `blockId`(들)을 찾는다. (interval overlap)
4) 해당 target `blockId`가 포함된 `segmentGroup`을 찾는다.
5) `segmentGroup.sourceIds + segmentGroup.targetIds`를 `contextBlocks`로 구성한다.
6) 모델 호출 payload에 `contextBlocks`(원문/번역)를 포함한다.

What (fallback 규칙):
- tracked ranges가 아직 없거나 매핑 실패 시:
  - 최소한 `selectionText + before/after + sourceDocument(근접 구간)`을 포함한다.
  - 단, `sourceDocument`를 생략하는 fallback은 금지한다(PRD 3.1 원칙 위배).

3.4 Edit Session(=Pending Edit) 모델 명세
Why:
- Cursor 경험의 핵심은 “모델이 텍스트를 곧장 바꾸지 않고, 편집 제안(세션)을 만들어 사용자가 유지/폐기한다”는 점입니다.
- 번역문에서도 동일하게, 제안이 실제 본문을 오염시키지 않게 “대기 상태”로 관리해야 합니다.

How:
- 모델 응답을 받으면 즉시 `EditSession`을 생성하고, 문서에는 “미리보기 상태”로만 표시합니다.
- 사용자가 Keep을 선택하면 실제 문서에 적용하고, Discard면 미리보기/세션을 제거합니다.

What (EditSession 스키마: 권장):
- `id`: 세션 ID
- `createdAt`: 생성 시각
- `kind`: `edit` | `translate`
- `target`: `targetDocument`
- `anchorRange`:
  - `startOffset`, `endOffset` (1차)
  - tracked range ID (가능하면) — Range-based Tracking과 결합
- `baseText`: 적용 전 원문(선택 구간 또는 전체 구간)
- `suggestedText`: 모델 제안 텍스트
- `diff`: diff-match-patch 결과(렌더링용)
- `status`: `pending` | `kept` | `discarded`
- `sourceContext`: 컨텍스트 구성에 사용된 요약(예: source snippet hash, glossary ids, memory hash)
- `origin`: 어떤 채팅 메시지/요청에서 생성됐는지(연결용)

What (상태 전이):
- `pending` → `kept`: 문서에 적용 + 히스토리/스냅샷 기록 + 미리보기 제거
- `pending` → `discarded`: 문서 변경 없이 미리보기/세션만 제거
- `kept/discarded`는 재편집을 위해 새 세션으로만 생성(세션은 불변 기록으로 취급)

3.5 워크플로우(사용자 여정) 기반 기술 요구사항 (user-journey.md 반영)
Why:
- 실제 사용 흐름(붙여넣기 → 참조 투입 → 번역 요청 → 비교/수정 → 질의 세션 분리 → 적용 결정)을 그대로 지원해야 제품이 “Cursor AI 방식의 번역 경험”이 됩니다.

What:
- 원문 붙여넣기
  - SourceDocument는 참조 전용이며, 프로젝트에 저장되고 항상 AI 컨텍스트로 주입 가능해야 함
- 설정(Settings)/참조 문서(글로서리 등)
  - AI 채팅 패널에는 “Settings” 화면이 존재하며, 여기에서 사용자 편집 가능한 설정을 관리한다.
  - Settings 항목(최소): 시스템 프롬프트 오버레이(System Prompt Overlay), 번역 규칙(Translation Rules), Active Memory, 첨부 파일(참조문서/글로서리)
  - 시스템 프롬프트 오버레이는 모델 호출 시 system 메시지에 반영된다.
  - 글로서리 주입은 비벡터(임베딩/벡터화 없음)로 한다.
- 멀티 채팅 세션
  - “번역 작업 세션”과 “개념 질의 세션”을 분리할 수 있어야 함
  - 세션별로 Active Memory(요약)와 첨부 컨텍스트 상태(선택/블록/참조문서 범위)를 관리
- 선택 → 재수정
  - Add to chat은 “텍스트 추가” UX로 유지
  - Edit 요청은 반드시 원문/번역 자동 주입이 보장되어야 함(3.2~3.3)
- 적용 결정(반영/미반영)
  - 모든 편집 제안은 항상 Diff Preview를 거치며, Keep/Discard의 결과가 저장/히스토리와 정합해야 함
- 저장/재개
  - `.ite` 프로젝트 파일에 `blocks/segments/채팅 세션/참조 문서/요약 메모리`가 함께 저장되어 재개 시 그대로 복원되어야 함

3.6 AI Chat UX 명세 (Tabs, Settings, Message Edit)
Why:
- 번역 작업은 “문서 편집”과 “대화/검수”가 동시에 진행되므로, 채팅 UX가 일반적인 AI 앱(ChatGPT/Claude) 수준의 편집성과 멀티 스레드를 제공해야 한다.

What:
- 멀티 탭 채팅(Thread Tabs)
  - 하나의 프로젝트 내에서 AI 채팅 탭을 여러 개 생성/전환할 수 있어야 한다.
  - 탭들은 동일 프로젝트의 Settings(시스템 프롬프트 오버레이/번역 규칙/Active Memory/첨부 파일 등)를 공유한다.
  - 각 탭(thread)은 메시지 히스토리를 독립적으로 가진다.
- Settings 화면 전환(Replace)
  - 기존 “System Prompt” 버튼은 “Settings”로 명명한다.
  - Settings를 열면 채팅 메시지 리스트/입력창은 숨겨지고, 해당 탭의 화면이 Settings UI로 “교체(replace)”된다.
  - Settings를 닫으면 원래의 채팅 화면으로 복귀한다.
- 메시지 수정(Edit Message) — 일반 AI 채팅 UX
  - 사용자는 기존 사용자 메시지(내가 보낸 메시지)를 수정할 수 있어야 한다.
  - 메시지를 수정하면, 그 메시지 “이하”의 메시지는 모두 삭제(truncate)된다.
  - 삭제(truncate) 이후의 흐름은 사용자가 재전송/재생성을 명시적으로 요청할 때만 진행한다(On-Demand 유지).
  - (권장) 수정 이력: `editedAt`, `originalContent`를 보관하여 디버깅/재현성을 확보한다.
- EditSession 정합성(중요)
  - 메시지 수정으로 인해 삭제된 요청에서 파생된 `pending` EditSession은 자동으로 `discarded` 처리한다.
  - 이미 `kept`된 변경은 문서 상태로 확정된 것이므로 되돌리지 않는다(되돌림은 별도 히스토리/undo 정책으로 처리).

3.7 Settings 필드명/프롬프트 변수명 일관화
What:
- Settings의 “참조문서/용어집 메모(모델에 그대로 전달)” 필드명은 “번역 규칙”으로 변경한다.
- 내부 변수명도 `referenceNotes` 대신 `translationRules`로 일관되게 변경한다.
- Payload/프롬프트 섹션 라벨 또한 “번역 규칙(Translation Rules)”로 통일한다.

3.8 첨부 파일(Reference Attachments) 확장 명세
Why:
- CSV/Excel뿐 아니라, PDF/PPTX/이미지/Markdown/DOCX 등 다양한 참고 자료를 “프로젝트에 첨부”하여 모델에 전달할 수 있어야 한다.

What:
- 지원 파일(1차 목표): csv, xlsx/xls, pdf, pptx, png/jpg/webp, md, docx
- 저장/공유:
  - 첨부 파일은 프로젝트 단위로 관리되며, 모든 채팅 탭이 동일 첨부 목록을 공유한다.
- 모델 전달 원칙:
  - 기본: Provider(OpenAI/Anthropic 등)가 제공하는 “파일 업로드/첨부” 메커니즘을 사용해, 첨부 파일을 원형 그대로 모델 입력에 포함한다.
  - 파일 전달은 On-Demand 모델 호출 시점에만 수행하며(사용자 요청 기반), 요청 payload에는 업로드된 파일 참조(예: file_id 등)와 함께 “어떤 파일을 참고해야 하는지”를 명시한다.
  - (호환성/폴백) 특정 포맷/모델에서 파일 첨부가 불가한 경우에만 텍스트 추출(및 이미지 OCR)로 폴백하여 payload에 포함한다.
  - 과도한 컨텍스트 방지를 위해 파일별/전체 길이 제한 및 우선순위(사용자 선택/최근 첨부/키워드 매칭)를 둔다.

4. 데이터 영속성 (Data & Storage)
4.1 SQLite 기반의 단일 파일 구조 (.ite)
Why:
- 번역 데이터, AI 대화 로그, 수정 이력(History)이 모두 하나의 맥락 안에서 보존되어야 합니다.

How:
- Rust 백엔드에서 `rusqlite`로 프로젝트 DB를 관리하고, 저장 시 단일 `.ite` 파일로 패킹합니다.

What (Schema 개요):
- `blocks`: 각 문단/문장의 원문 및 번역문 데이터
- `chat_sessions`: 대화 로그 및 컨텍스트 요약본
- `snapshots`: 특정 시점의 전체 텍스트 상태(Version Control)

What (Project Metadata UX):
- 사이드바에서 Project 이름을 수정(rename)할 수 있어야 한다.
- 변경된 Project 이름은 프로젝트 메타데이터로 저장되며 `.ite`에 영속화되어 재개 시 복원되어야 한다.

5. 특화 기능 명세 (Specialized Sub-systems)
5.1 Ghost Chips (태그 보호)
Why:
- 게임 데이터의 `{user}`, `<br>` 등의 변수는 번역 과정에서 절대 손상되면 안 됩니다.

How:
- Regex Engine: 로드 시 정규식으로 태그 위치 파악
- Decorations: 해당 범위를 ReadOnly 속성이 부여된 시각적 배지(Chip)로 감싸기

What:
- 사용자가 배지 내부를 직접 수정하는 것을 방지
- AI 전송 시 고유 토큰으로 치환→복원하여 손상 방지

5.2 Smart Context Summarizer
Why:
- 대화가 길어질수록 LLM의 컨텍스트 윈도우 한계에 도달하고 비용이 증가합니다.

How:
1) 대화 토큰 수를 실시간 모니터링한다.
2) 임계치 도달 시, 과거 대화에서 확정된 “용어”와 “스타일 규칙”만 추출해 요약한다.
3) 요약본을 시스템 프롬프트의 Active Memory 섹션으로 전송한다.

What (Active Memory 제안 UX: Confirm-to-Add):
- 시스템은 대화 중 “중요 규칙/용어/톤”을 감지하면 사용자에게 “Memory에 추가할까요?”를 제안할 수 있다.
- 사용자가 YES를 선택한 경우에만 Active Memory에 추가한다(자동 추가 금지).
- 제안 트리거는 분류용 모델 호출을 허용한다.
  - 단, 사용자가 메시지를 전송한 “요청 처리 흐름” 내부에서만 수행하며(백그라운드 자동 실행 금지), 별도/추가적인 문서 자동 수정은 하지 않는다.
  - 분류 모델의 출력은 “제안 여부/후보 문구”에 한정하고, 실제 Active Memory 반영은 사용자 YES 확인 후에만 수행한다.

6. 개발 도구 및 환경 (Dev Tools)
State Management: Zustand (Global Store), Immer (Immutable Updates).

Formatting/Linting: Prettier, ESLint.

Testing: Vitest (Unit), Playwright (E2E for Tauri).

💡 기술적 체크포인트
Performance: Monaco 에디터 두 개(Source/Target) 동시 렌더링 시 60fps 유지 확인.

IPC Latency: 대용량 텍스트 저장 시 Rust-React 간 통신 지연시간 50ms 미만 유지.

Diff Accuracy: 한글 특유의 조사 변화나 어미 변화 시 Diff 알고리즘이 자연스럽게 하이라이트를 생성하는지 검증.