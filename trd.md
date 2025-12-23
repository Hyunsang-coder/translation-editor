🛠 [TRD] Integrated Translation Editor (ITE) Technical Specifications

이 문서는 ITE의 **기술 설계도(Source of Truth)**입니다. 구현/문서가 충돌하면 본 문서를 기준으로 정리합니다.

표기 규칙:
- **Why**: 왜 필요한가(의도/리스크)
- **How**: 어떻게 구현할까(접근/전략)
- **What**: 정확히 무엇을 만든다(명세/규칙)

---

## 1. 아키텍처 개요 (System Architecture)

### 1.1 기반 기술 (The Dual-Core Approach)

**Why**:
- 전문 번역가는 대용량 텍스트를 다루며, AI 응답을 참조하면서 직접 편집하는 고집중 작업을 수행합니다.
- Electron 대비 리소스가 가볍고 네이티브 접근이 강력한 Tauri가 유리합니다.

**How**:
- Backend (Rust): 파일 시스템 제어, SQLite DB 관리
- Frontend (React + TS): UI 렌더링, TipTap 에디터 관리, 상태 관리(Zustand)

**What**:
- SQLite 기반 단일 `.ite` 프로젝트 파일을 지원하는 네이티브 데스크톱 애플리케이션

---

## 2. 에디터 엔진 설계 (TipTap/ProseMirror)

### 2.1 TipTap 에디터 구성

**Why**:
- Notion 스타일의 리치 텍스트 편집이 필요합니다.
- 번역가는 텍스트 가독성과 자유로운 서식 지정을 최우선으로 합니다.

**How**:
- TipTap (ProseMirror 기반) 에디터를 사용합니다.
- Source/Target 두 개의 에디터 인스턴스를 운영합니다.

**What**:
- **Source 패널**: TipTap 편집 가능 (원문 붙여넣기/정리/편집)
- **Target 패널**: TipTap 편집 가능
- **공통 스타일**: Notion 감성 (Pretendard 폰트, 행간 1.8, 16px)

### 2.2 지원 포맷

**What (리치 텍스트 요소)**:
- 헤딩 (H1-H6)
- 불릿 리스트 / 번호 리스트
- 볼드, 이탤릭, 취소선
- 인용 블록 (Blockquote)
- 코드 블록 (선택적)
- 하이퍼링크

### 2.3 데이터 모델

**What**:
- TipTap JSON 형식으로 에디터 내용 저장
- SQLite `blocks` 테이블에 JSON 컬럼으로 저장
- 문서 구조는 ProseMirror의 `doc > paragraph/heading/list` 계층 유지

### 2.4 에디터 스타일 가이드

**What (권장 CSS)**:
```css
.tiptap-editor {
  font-family: 'Pretendard', sans-serif;
  font-size: 16px;
  line-height: 1.8;
  max-width: 800px;
  padding: 24px;
}
```

---

## 3. AI 상호작용 (LangChain.js 기반)

### 3.1 핵심 원칙

**Why**:
- 번역사가 주도권을 가지고, AI는 조력자 역할만 수행합니다.
- 번역문 수정은 99% 사용자가 직접 수행하므로, AI가 자동으로 문서를 변경하지 않습니다.

**What**:
- AI는 요청 시에만 응답 (Non-Intrusive)
- 번역 vs 질문 구분: 채팅 탭 분리 권장
- 간결한 응답: 불필요한 설명 없이 핵심만

### 3.2 문서 전체 번역 워크플로우 (Preview → Apply)

**Why**:
- 채팅 응답을 복사/붙여넣기 할 때 HTML/서식이 섞이면 TipTap에서 서식이 깨지고 UX가 나빠집니다.
- “문서 편집(Document-First)” 흐름에서 번역은 “텍스트 복사”가 아니라 “문서에 적용”이 기본이 되어야 합니다.

**How**:
- 사용자가 **Translate 버튼(또는 단축키)**로 명시적으로 트리거합니다.
- Source 문서 전체를 **TipTap JSON**으로 수집하고, 모델 출력도 **TipTap JSON만** 반환하도록 강제합니다.
- 결과는 먼저 **Preview**로 렌더링하고, 사용자가 **Apply**를 누를 때만 Target 문서를 **전체 덮어쓰기**합니다.
- 번역 생성 시 채팅 히스토리는 포함하지 않습니다. (히스토리 기반 컨텍스트는 사용하지 않음)
- 톤/용어/스타일 반영은 `Translation Rules`/`Active Memory`(및 Add to Rules)로 관리합니다.

**What (명세)**:
- **Trigger**: `Translate (Preview)` 버튼 클릭(또는 단축키)
- **Input Payload**
  - 필수: `sourceDocJson` (TipTap JSON; `doc` 루트)
  - 필수: `domain`
  - 조건부: `translationRules`, `activeMemory`
  - (선택) `targetDocJson` (재번역/일관성 유지용)
- **Output Contract (강제)**
  - 모델은 **오직 JSON만** 출력합니다. (code fence/마크다운/설명/HTML 금지)
  - 최상단은 TipTap/ProseMirror `doc` 스키마를 유지합니다.
  - 노드 구조(heading/list/marks/link 등)는 유지하고 **텍스트 노드만 번역**합니다.
  - 번역 불가/불확실 시에는 오류 JSON을 반환합니다:
    - 예: `{ "error": "…", "doc": null }`
- **Preview**
  - 결과 JSON을 읽기 전용 TipTap으로 렌더링
  - Apply 전까지 Target 문서 변경 없음
  - Preview가 열리고 응답을 기다리는 동안은 **진행 중임을 명확히 표시**해야 합니다.
    - 예: 스피너 + indeterminate progress bar + “번역 생성 중…” 문구
- **Apply**
  - Target 문서를 결과 JSON으로 **전체 덮어쓰기**
  - Apply는 “사용자 직접 결정” 원칙을 지킴(Non-Intrusive)

### 3.3 프롬프트 전략 (채팅=질문 전용)

**Why**:
- 번역 요청과 질문을 명확히 구분해야 사용자 경험이 일관됩니다.
- 불필요한 설명이나 마크다운 포맷은 번역가에게 노이즈입니다.

**What (프롬프트 규칙)**:

**채팅(Chat) 요청**:
- 채팅은 **질문/설명/검토** 용도이며, **번역 결과를 직접 출력하지 않습니다.**
- 사용자가 번역/리라이트/전체 번역을 요구해도, 채팅은 다음 중 하나로만 응답합니다:
  - (필요 시) **0~1개의 확인 질문** (예: 톤/용어 규칙/금지어 등)
  - 그 외에는 **“Translate(Preview) 버튼을 눌러서 실행”**하도록 안내
- 목적: 복사/붙여넣기 기반 번역을 차단하고, 서식 보존이 가능한 “문서 전체 번역(Preview→Apply)” 워크플로우로 유도합니다.
 - 단, 채팅에서 다음과 같은 **검수/리뷰/검증 요청은 허용**합니다:
   - 원문↔번역문 비교(누락/오역/과잉 번역)
   - 용어 일관성/표기 규칙 위반 탐지
   - 톤/문체 적합성 평가 및 수정 방향 제안(직접 번역 생성이 아니라 “지적/가이드” 중심)
 - 채팅 응답 포맷은 간결하게 유지하며, 필요 시 **불릿/리스트/강조(볼드/이탤릭)**를 사용할 수 있습니다.

**질문 요청**:
```
당신은 번역 전문가 어시스턴트입니다.
사용자의 질문에 간결하게 답변하세요.

[컨텍스트]
원문: {sourceText}
번역문: {targetText}

[질문]
{userQuestion}
```

### 3.4 LangChain.js Tools (추후 구현)

**Why**:
- 검수, 오탈자 체크, 일관성 체크 등을 별도 함수(Tool)로 정의하면 프롬프트 관리가 명확해집니다.
- 추후 MCP 연동 시 확장이 용이합니다.

**What (Tool 정의 예시)**:

```typescript
// tools/checkSpelling.ts
const checkSpellingTool = {
  name: "checkSpelling",
  description: "번역문의 오탈자를 검사합니다",
  parameters: {
    text: { type: "string", description: "검사할 텍스트" }
  },
  execute: async (params) => {
    // 오탈자 검사 로직
    return { errors: [...] };
  }
};

// tools/checkConsistency.ts
const checkConsistencyTool = {
  name: "checkConsistency",
  description: "용어 일관성을 검사합니다",
  parameters: {
    text: { type: "string", description: "검사할 텍스트" },
    glossary: { type: "array", description: "용어집" }
  },
  execute: async (params) => {
    // 일관성 검사 로직
    return { issues: [...] };
  }
};

// tools/reviewQuality.ts
const reviewQualityTool = {
  name: "reviewQuality",
  description: "번역 품질을 검수합니다",
  parameters: {
    source: { type: "string", description: "원문" },
    target: { type: "string", description: "번역문" }
  },
  execute: async (params) => {
    // 품질 검수 로직
    return { score: number, feedback: [...] };
  }
};
```

### 3.5 Add to Chat

**What**:
- 선택 텍스트를 채팅 입력창(composer)에 추가하는 보조 UX
- 모델 호출 없음, 순수하게 텍스트 준비 용도
- 원문/번역문 컨텍스트를 함께 수집하여 사용자가 쉽게 요청할 수 있도록 지원

### 3.6 Context Collection 규칙

**What (Payload 구성)**:
- **반드시 포함**
  - 프로젝트 메타: `domain`
  - 원문 컨텍스트: Source 패널의 텍스트 (항상 최우선 맥락)
- **조건부 포함**
  - 선택된 텍스트: 사용자가 선택한 범위
  - 번역문: Target 패널의 현재 내용
  - 참조 문서/글로서리: 사용자가 첨부한 경우
  - Active Memory: 이전 대화에서 확정된 용어/스타일 규칙
  - 채팅 히스토리: 포함하지 않음 (항상 제외)

### 3.7 MCP 연동 (추후 예정)

**What**:
- 웹검색 도구 연동
- 외부 사전 API 연동
- 참고 자료 검색 도구

---

## 4. AI Chat UX 명세

### 4.1 멀티 탭 채팅 (Thread Tabs)

**Why**:
- 번역 작업과 질문/검수를 분리하면 대화 맥락이 깔끔해집니다.
- 각 탭이 독립적인 메시지 히스토리를 가지면 컨텍스트 관리가 용이합니다.

**What**:
- 하나의 프로젝트 내에서 AI 채팅 탭을 여러 개 생성/전환 가능
- 탭들은 동일 프로젝트의 Settings(시스템 프롬프트/번역 규칙/Active Memory/첨부 파일)를 공유
- 각 탭(thread)은 메시지 히스토리를 독립적으로 보유
- **권장 사용법**: 번역용 탭 / 질문용 탭 분리

### 4.2 Settings 화면

**What**:
- "Settings" 버튼을 누르면 채팅 화면이 Settings UI로 교체
- Settings 닫으면 원래 채팅 화면으로 복귀

**Settings 항목**:
- 시스템 프롬프트 오버레이 (System Prompt Overlay)
- 번역 규칙 (Translation Rules)
- Active Memory
- 첨부 파일 (참조문서/글로서리)

### 4.3 메시지 수정 (Edit Message)

**What**:
- 사용자가 기존 사용자 메시지를 수정 가능
- 메시지 수정 시 해당 메시지 이하의 메시지는 삭제(truncate)
- 삭제 후 재전송은 사용자가 명시적으로 요청할 때만 진행 (On-Demand)
- (권장) 수정 이력: `editedAt`, `originalContent` 보관

### 4.4 메시지 삭제 (Delete Message)

**What**:
- 사용자가 기존 메시지를 삭제 가능
- 메시지 삭제 시 **해당 메시지 이하의 메시지는 삭제(truncate)** (맥락 일관성 유지)

### 4.5 채팅 메시지 서식 (Markdown, GFM)

**Why**:
- 채팅에서 검수/검증 결과를 구조화(리스트/강조)하면 가독성이 크게 향상됩니다.

**What**:
- 채팅 메시지는 Markdown(GFM) 렌더링을 지원합니다:
  - 불릿/번호 리스트
  - 볼드/이탤릭/취소선(선택)
  - 링크(선택)
- 보안: 메시지 내 **HTML은 렌더링하지 않습니다**(예: `skipHtml`).

### 4.6 Add to Rules (Confirm-to-Append)

**What**:
- assistant 최종 응답이 **스타일/톤/번역 규칙/용어 규칙** 성격일 때, 응답 하단에 `Add to Rules` 버튼을 표시할 수 있습니다.
- 사용자가 `Add to Rules`를 클릭하면 `Translation Rules`에 **append**합니다.
  - append 시 **빈 줄(\\n\\n)로 구분**하고, 줄바꿈은 필수입니다.

### 4.7 채팅에서의 자동 적용 금지

**What**:
- 채팅은 문서에 대한 **자동 적용/선택영역 적용(Apply to selected text)** UI/기능을 제공하지 않습니다.
- 문서 변경은 사용자가 에디터에서 직접 수행하거나, Translate(Preview→Apply) 워크플로우에서 **전체 덮어쓰기 Apply**로만 반영합니다.

---

## 5. 데이터 영속성 (Data & Storage)

### 5.1 SQLite 기반 단일 파일 구조 (.ite)

**Why**:
- 번역 데이터, AI 대화 로그, 수정 이력이 모두 하나의 맥락 안에서 보존되어야 합니다.

**How**:
- Rust 백엔드에서 `rusqlite`로 프로젝트 DB를 관리
- 저장 시 단일 `.ite` 파일로 패킹

**What (Schema 개요)**:
- `projects`: 프로젝트 메타데이터 (이름, 언어 설정 등)
- `documents`: Source/Target 문서 (TipTap JSON)
- `chat_sessions`: 대화 탭 정보
- `chat_messages`: 대화 로그
- `settings`: 프로젝트별 설정 (시스템 프롬프트, 번역 규칙 등)
- `snapshots`: 특정 시점의 전체 텍스트 상태 (Version Control)

### 5.2 TipTap JSON 저장

**What**:
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'source' | 'target'
  content TEXT NOT NULL, -- TipTap JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

### 5.3 Project Metadata UX

**What**:
- 사이드바에서 Project 이름을 수정(rename) 가능
- 변경된 Project 이름은 `.ite`에 영속화되어 재개 시 복원

---

## 6. 특화 기능 명세

### 6.1 Smart Context Summarizer

**Why**:
- 대화가 길어질수록 LLM의 컨텍스트 윈도우 한계에 도달하고 비용이 증가합니다.

**How**:
1. 대화 토큰 수를 실시간 모니터링
2. 임계치 도달 시, 과거 대화에서 확정된 "용어"와 "스타일 규칙"만 추출해 요약
3. 요약본을 시스템 프롬프트의 Active Memory 섹션으로 전송

**What (Active Memory 제안 UX: Confirm-to-Add)**:
- 시스템은 대화 중 "중요 규칙/용어/톤"을 감지하면 "Memory에 추가할까요?" 제안 가능
- 사용자가 YES를 선택한 경우에만 Active Memory에 추가 (자동 추가 금지)
- 제안 트리거는 분류용 모델 호출 허용 (사용자 요청 흐름 내에서만)

### 6.2 Integrated Glossary (비벡터)

**What**:
- 용어집 파일을 로컬에서 직접 읽기 (필요 시 SQLite로 임포트)
- 텍스트 기반 검색 (룰/FTS)으로 관련 용어 추출
- 임베딩/벡터화 없이 단순하고 예측 가능한 동작

### 6.3 첨부 파일 (Reference Attachments)

**What**:
- 지원 파일 (1차 목표): csv, xlsx/xls, pdf, pptx, png/jpg/webp, md, docx
- 첨부 파일은 프로젝트 단위로 관리, 모든 채팅 탭이 동일 첨부 목록 공유
- 모델 전달: Provider의 파일 업로드/첨부 메커니즘 활용 (원형 그대로)
- 폴백: 파일 첨부 불가 시 텍스트 추출로 대체

---

## 7. 개발 도구 및 환경 (Dev Tools)

**State Management**: Zustand (Global Store), Immer (Immutable Updates)

**Formatting/Linting**: Prettier, ESLint

**Testing**: Vitest (Unit), Playwright (E2E for Tauri)

**Editor**: TipTap v2 (ProseMirror 기반)

**AI Runtime**: LangChain.js (TypeScript, 프론트엔드에서 실행)

---

## 8. 기술적 체크포인트

**Performance**:
- TipTap 에디터 두 개(Source/Target) 동시 렌더링 시 60fps 유지 확인

**IPC Latency**:
- 대용량 텍스트 저장 시 Rust-React 간 통신 지연시간 50ms 미만 유지

**Rich Text Fidelity**:
- TipTap JSON → 저장 → 로드 → 렌더링 시 서식 손실 없음 검증

---

## 9. 삭제된 기능 (참고용)

다음 기능들은 제품 방향성 변경으로 제거되었습니다:

- ~~Monaco Editor~~ → TipTap으로 대체
- ~~Range-based Tracking~~ → 사용자 직접 수정 방식으로 불필요
- ~~Diff Preview / Keep / Discard~~ → 사용자가 직접 수정하므로 불필요
- ~~Pending Edit / EditSession~~ → 자동 적용 워크플로우 제거
- ~~Ghost Chips (태그 보호)~~ → 기능 제거
- ~~diff-match-patch~~ → Diff 시각화 불필요

향후 "전체 덮어쓰기" 기능 구현 시 일부 개념이 부활할 수 있으나, 현재 버전에서는 제외합니다.
