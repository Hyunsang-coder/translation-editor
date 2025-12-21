📑 Integrated Translation Editor (ITE) Implementation Tasks
🚀 Phase 1: 기반 구축 및 에디터 커스터마이징
목표: Tauri 환경 세팅 및 Monaco 에디터를 '문서 에디터' 감성으로 튜닝하여 3패널 레이아웃 완성.

[x] 1.1 프로젝트 초기화 및 환경 설정

[x] npx tauri init을 통한 프로젝트 생성 (React + TypeScript + Vite)

[x] 필수 라이브러리 설치: zustand, @monaco-editor/react, tailwindcss, diff-match-patch, langchain(+providers)

[x] 전역 테마 및 Pretendard 폰트 설정

[x] 1.2 Monaco Editor "Document Mode" 구현

[x] EditorOptions 정의: lineNumbers off, minimap off, wordWrap on, lineHeight 확보

[x] Source(ReadOnly) / Target(Editable) Monaco 에디터 생성 및 컴포넌트화

[x] 1.3 3패널 레이아웃 및 Focus Mode

[x] 좌(Source) / 중(Target) / 우(AI Chat) 3패널 레이아웃 구현

[x] 원문 패널 숨기기(Focus Mode) 토글

🧠 Phase 2: AI 연동 및 인터랙션 엔진
목표: TRD의 Context Collection 규칙에 따라, 선택/문맥/원문/참조를 조립해 AI 요청을 만들고(필요 시 스트리밍) 응답을 Pending Edit로 전환할 기반을 마련.

[x] 2.1 Context Collection (맥락 수집) 로직

[x] 선택 범위(Range) 및 텍스트/오프셋 추출 (selectionText, start/endOffset, before/after)

[x] 선택 범위(offset) → tracked ranges → segment/block 매핑으로 Source 컨텍스트 자동 주입

[x] 2.2 AI 호출 & LangChain 연동

[x] OpenAI/Claude API Key 환경변수 기반 구성 (VITE_* 키)

[x] 스트리밍 응답 처리(useAIStream 등) + UI 반영

[x] 시스템 프롬프트/컨텍스트 어셈블러(기본) + 사용자 편집 오버레이
  - (개선) SystemMessage를 정책/메타/컨텍스트로 분리 + ChatPromptTemplate/MessagesPlaceholder(history) 기반 조립

[x] 2.3 Inline Command UI (Cursor 스타일)

[x] Monaco OverlayWidget 기반 플로팅 입력창 구현(버튼/메뉴/단축키 트리거는 별도)

[x] 입력창 호출 시 에디터 포커스/선택 Range 고정(Tracked range 연계)

[x] 컨텍스트 실패 시 원문(Source) 강제 포함 fallback 적용

[x] 참조문서/용어집 첨부 UI + 페이로드 주입(최소 전달 경로)

[x] 용어집/Active Memory 요약을 페이로드에 주입하는 경로 추가

✨ Phase 3: Pending Edit(Keep/Discard) 시스템 & Diff (Critical)
목표: Cursor 스타일의 핵심 루프인 **Pending Edit → Diff Preview → Keep/Discard**를 번역 문서에 맞게 구현.

[~] 3.1 Diff 계산 및 Preview UI

[x] diff-match-patch 기반 델타 계산 유틸 준비

[~] Diff Preview UI (1차: DiffEditor 모달 구현됨 / Keep-Discard 용어 및 UX 정리 필요)

[~] 3.2 In-place Preview(문서 내 미리보기) 구현

[x] 실제 텍스트 확정 전, 문서 내 “미리보기 상태”로 렌더(Decorations/overlay)
[x] Pending 범위를 Monaco tracked decoration으로 앵커링하여(오프셋 변동 대응) Keep 시점에 범위 재계산

[~] 3.3 Pending Edit 세션 모델(편집 세션) 구현

[~] EditSession 스키마/상태 전이(pending→kept/discarded) 및 히스토리 연계(상태 전이 1차 완료 / 히스토리 연계는 후속)

[~] Keep: 제안 적용 + 미리보기/데코레이션 제거 + 저장/히스토리 정합(적용/제거 1차 완료)

[x] Discard: 세션/미리보기 제거 + 원문 상태 복구

💾 Phase 4: 데이터 관리 및 .ite 파일 시스템
목표: SQLite를 활용한 프로젝트 저장 체계 구축 및 단일 파일 패키징.

[~] 4.1 Rust 백엔드 데이터 레이어 (Tauri + SQL)

[~] rusqlite 연동 및 프로젝트/블록/로그 테이블 스키마 정의(기본 구현)

[~] create/load/save 프로젝트 Tauri Command 구현(기본 구현)

[~] 4.2 프로젝트 세이브/로드 시스템

[x] SQLite DB를 단일 `.ite` 파일로 패킹/언패킹(포맷 고정) (rusqlite backup 기반 export/import)

[x] 최근 프로젝트/자동 저장(Auto-save) 기본(프로토타입) → 안정화/정책 확정
[x] Recent Projects: 최근 프로젝트 목록 조회/선택 UI(Open) + 자동 로드(최신 1개)
[x] Recent Projects: 목록에서 단건 삭제(🗑) + Clear All(전체 삭제) + 로드 실패 시 오류 표시/삭제 제안
[x] Import/Export: 파일 다이얼로그 기반 + Import 전 자동 백업(import_project_file_safe)
[x] Export: 백엔드에서 파일 생성/0 byte 검증 + 프론트에서 성공/실패 메시지(저장 경로/오류) 표시
[x] Chat: 프로젝트별 현재 세션 1개 + ChatPanel 설정(systemPrompt/reference/activeMemory/include flags) DB 저장/복원(.ite 포함)
[x] Sidebar Projects: 좌측 사이드바에서 프로젝트 생성(+ New)/선택(마지막 상태 복귀)/삭제 + 전환 시 자동 저장(auto-save-and-switch)
[x] Toolbar: Open/Export/Import UI 제거(사이드바 프로젝트 UX로 대체)
[x] Auto-save 정책: 디바운스(마지막 변경 후 1.5s idle) + 저장 상태(Saved/Unsaved/Saving) 표시

[~] 4.3 Smart Context Memory

[~] 대화 길이/토큰 임계치 기반 “핵심 의사결정(용어/스타일) 요약” 자동 생성 (자동 호출은 금지 → 임계치 도달 시 ‘요약 생성’ 제안 + 사용자 클릭 시 생성)

[x] 요약본을 이후 Context Collection의 Active Memory로 주입 (Active Memory 업데이트 + 이후 모델 호출 payload에 주입)

🛡️ Phase 5: 전문 기능 (Tag Protection & RAG)
목표: 게임 번역 특화 기능(태그 보호) 및 용어집 검색 효율화.

[~] 5.1 Ghost Chips (태그 보호 시스템) — UI 보호 + AI 무결성
설명: “문서 내 편집 방지(UX)”와 “모델 입출력 보존(무결성)”을 분리해 구현/검증한다.

[x] 정규표현식을 통한 변수/태그({user}, <br>) 자동 감지

[x] Monaco decorations + 편집 차단(undo) 기반 태그 보호(프로토타입)

[x] AI 전송용 태그 마스킹/복구 엔진 (Ghost Chips → Safe Tokens → Restore)

[x] 모델 응답 결과 검증(원형 보존)
- 선택 구간 기반(Edit 요청): “선택 구간에 존재하던 태그/변수 집합”이 응답에 그대로 포함되는지 검증
- 불일치 시: Apply(Keep) 불가 처리 + 사용자에게 원인 안내(누락/변형된 토큰)

[x] 에디터/프롬프트 경로 전체에 일관 적용(중요)
- sendMessage(채팅) / sendApplyRequest(편집) 모두 동일한 마스킹 규칙 적용
- referenceNotes / activeMemory / 전체 문서 포함 옵션(includeSource/includeTarget)에도 동일 적용 여부 결정 및 정리

[x] Ghost Chips 정규식/엣지 케이스 정리
- 줄바꿈 토큰: "\\n"(리터럴) + <br> 계열을 기본 보호, 필요 시 실제 '\n'까지 옵션으로 확장 가능
- 속성 있는 태그/하이픈 태그(<br />, <b class="x">, <custom-tag>) 감지 지원

[~] 5.2 로컬 용어집(Glossary) “RAG” — 비벡터(업로드 파일 직접 읽기 + 룰/FTS 검색)
설명: 업로드한 glossary를 직접 읽어(로컬) 텍스트 기반 검색으로 관련 용어를 추출해 주입한다. 임베딩/벡터화는 하지 않는다.

[~] 5.2.1 용어집 임포트 (CSV/Excel → 로컬 DB)
- parsing/정규화(중복/공백/대소문자 정책) 규칙 정의
- 프로젝트별/전역 용어집 구분(필요 시)
- 업로드 파일 변경 감지(해시/mtime) 및 재임포트 정책(수동/반자동) 확정
  - (구현) CSV 임포트(Tauri command) + project scope upsert
  - (구현) Excel(.xlsx/.xls) 임포트(Tauri command) + project scope upsert
  - (후속) Excel 파일의 다양한 셀 타입/시트 선택 UX 고도화

[~] 5.2.2 용어집 조회 API (로컬 DB 검색)
- 1차: 룰 기반(정확 매칭/부분 매칭/케이스 민감 옵션)으로 Top N 추출
- 2차(후속): SQLite FTS5/BM25 등 랭킹 강화(선택)
  - (구현) query 텍스트 내 포함 여부(inText) 기반 Top N (length(source) DESC)

[~] 5.2.3 모델 호출 payload 주입 (On-demand 유지)
- 사용자 요청(sendMessage/sendApplyRequest) 시에만 관련 용어를 system/context 섹션에 주입
- 디버깅 가능하게 “주입된 용어 리스트”를 UI에서 확인 가능하게(간단 로그/토글)
  - (구현) ChatPanel에서 CSV 가져오기 + 최근 주입 용어 리스트 표시(디버깅)

[~] 5.2.4 태그 보호와 결합 테스트
- 용어집 항목에 태그/변수가 포함된 경우에도 마스킹/복구/검증이 깨지지 않는지 확인

[ ] 5.3 최종 폴리싱

[ ] 타임라인 기반의 수정 이력 추적 UI (Smart History)

[~] 다크 모드/라이트 모드 지원(기본) 및 단축키 커스텀 설정창

[NEW] 🤖 Phase 6: LangGraph Agent & Tools (On-demand, Report-first)
목표: TRD의 “Router → Executor” 모델을 기반으로, 사용자가 요청하면 Agent가 판단하여 Tool을 호출하고(필요 시 반복),
기본 결과는 **리포트(JSON)**로 제공하며, 적용은 별도 명시 요청 시에만 Pending Edit로 전환한다.

[ ] 6.1 Agent 오케스트레이션 설계 확정 (Router → Executor)
- taskType 정의(고정): edit_selection / edit_document / translate_document / check_target / check_compare
- Router 전략 1차(룰 기반): 키워드 + 선택 유무 + include flags로 결정
  - 예: “오탈자/검수/체크” → check_target, “원문/비교/대조/검수” → check_compare
  - 예: “전체/전반/문체/통일” → edit_document, 선택 존재 시 기본은 edit_selection 우선(옵션화 가능)
- Router 전략 2차(선택): JSON-only LLM router로 대체/보강 (모호한 요청 처리)
- Executor 계약 고정:
  - Edit/Translate 계열: Pending Edit 생성 → Diff Preview → Keep/Discard
  - Check 계열: JSON 리포트만(기본), 문서 자동 변경 금지(“적용” 요청 시 edit_*로 전환)

[ ] 6.2 Tool 프레임워크(공통) 구축
- Tool 인터페이스/스키마(zod):
  - 입력: project meta, target text(선택/전체), (옵션) source text, glossary/activeMemory, ghost mask info
  - 출력: check-report@v1(JSON) 또는 “적용 후보” 형태(후속)
- Ghost Chips 가드 일관 적용 정책 결정:
  - 최소: user input + 최종 assistant output에 마스킹/복원/검증
  - 강화(선택): tool input/output에도 마스킹/복원/검증 적용
- Tool 실행 위치 정책:
  - 1차: 프론트(현재 구조와 자연 결합)
  - 후속: Rust sidecar/command로 이동 가능(대용량/성능/보안 고려)

[ ] 6.3 check_target: 오탈자/표기/띄어쓰기 검사 Tool (리포트 우선)
- 출력 포맷: check-report@v1(JSON only) 강제
- 이슈 항목: severity/category/message + target range(start/endOffset) + excerpt + suggestion.replaceText(옵션)
- Ghost Chips 관련 이슈 분류(category=tag) 지원

[ ] 6.4 check_compare: 원문-번역 비교 검수 Tool (리포트 우선)
- 비교 규칙(초기): 누락/추가 의미, 수치/고유명사 불일치, 용어집 위반, 태그 불일치
- source/target 모두 offset/excerpt를 채우되, 매핑 불가 시 source offsets는 null 허용
- 결과는 “적용 제안”이 아니라 “검수 포인트 리스트”가 기본

[ ] 6.5 LangGraph Agent 루프(툴 자율 호출) 도입
- MessagesAnnotation 기반 state(messages)로 Agent 실행
- llm(with tools) ↔ ToolNode 반복 루프 구성(툴콜 없으면 종료)
- thread_id를 Chat session id로 매핑하여 “요청 단위”가 아닌 “세션 단위”로 대화/툴 맥락 유지(선택)
- 스트리밍 UX: streamMode=values로 마지막 메시지 단계별 업데이트(초기)

[ ] 6.6 UI/UX 트리거(온디맨드 유지)
- 사용자가 “오탈자 체크해줘/검수해줘”라고 입력하거나, 버튼/메뉴/단축키로 명시 트리거했을 때만 Agent 실행
- Check 결과(JSON)를 UI에서 렌더:
  - 리스트/필터(severity/category)
  - 항목 클릭 시 해당 범위로 점프(오프셋 기반)
  - (후속) “이 제안 적용” 버튼은 edit_selection으로 재요청하여 Pending Edit 생성

[ ] 6.7 관찰성/재현성(디버깅)
- 요청 단위: taskType, prompt version, sections hash, 주입 glossary 요약, ghost chip 검증 결과 로그
- Check 리포트 JSON 파싱 실패/스키마 불일치 시 사용자에게 명확한 오류 안내

[ ] 6.8 테스트/회귀 방지(최소)
- Router 룰 기반 케이스 테스트(문구 → taskType)
- JSON 리포트 스키마 검증 테스트(zod)
- Ghost Chips 누락/변형 시나리오(리포트/편집 모두) 회귀 테스트
