# 선택 영역 중심 편집과 동적 프로젝트 컨텍스트 통합 계획

> - 상태: 구현 전 설계 기준 문서
> - 작성일: 2026-07-24
> - 대상 버전: OddEyes.ai 2.12.2 이후
> - 코드 기준선: `dd30ff2` 이후
> - 대상 문서 규모: 프로젝트당 최대 약 5,000단어
> - 핵심 원칙: Translator-led, Preview-first, No auto-apply, TipTap JSON canonical

## 0. 이 문서의 목적

이 문서는 새 개발 세션이 추가 조사 없이 다음 기능을 단계적으로 구현할 수 있도록 현재 코드 기준의 설계, 데이터 계약, 변경 파일, 테스트, 완료 조건을 정리한다.

구현 목표는 단순한 “부분 재번역 버튼” 추가가 아니다. 전체 번역과 전체 폴리싱 이후에도 번역가가 문서의 일부를 선택해 질문하고, 필요한 경우 수정안을 생성하고, 원래 위치에 안전하게 적용하며, 그 과정에서 확정된 프로젝트 지식을 이후 채팅·번역·검수·폴리싱에 재사용하는 통합 루프를 만드는 것이다.

최종 사용자 흐름:

```text
전체 번역/폴리싱
  → Source 또는 Target 일부 선택
  → 선택 영역 중심 질문 또는 Target 부분 재번역
  → AI 답변/수정안 확인
  → 선택 영역 미리보기
  → 원래 위치에 적용
  → 대화에서 확정된 규칙·용어·프로젝트 지식을 프로젝트 메모리에 저장
  → 새 채팅/다음 번역/검수/폴리싱에서 재사용
```

이 문서가 코드와 충돌하면 다음 순서로 판단한다.

1. `.claude/CLAUDE.md`와 연결된 프로젝트 지침
2. 사용자 데이터 보존과 Preview-first 원칙
3. 이 문서의 명시적 불변식
4. 현재 구현 세부사항

## 1. 문제 정의

### 1.1 현재 pain point

1. 전체 번역과 폴리싱이 문서 전체를 기반으로 동작하여 한두 문장만 surgical하게 수정하기 어렵다.
2. 채팅에 선택문을 넣어 질문할 수는 있지만, 선택 위치와 패널 정보가 사라지고 일반 문자열로만 전달된다.
3. 채팅 턴마다 번역 규칙, Project Context, 글로서리, 과거 대화와 여러 도구 정의가 함께 들어가 긴 대화에서 불필요한 토큰 사용이 누적된다.
4. 채팅에서 받은 수정안을 Target 패널에 수동으로 복사·붙여넣어야 한다.
5. AI 응답을 기다리는 동안 문서 앞부분이 수정되면 단순 숫자 위치로는 원래 선택 범위를 안전하게 찾을 수 없다.
6. 선택한 Target과 대응 Source 사이의 안정적인 연결 정보가 부족하다.
7. 채팅에서 발견한 프로젝트 지식은 일부 저장할 수 있지만 하나의 긴 문자열에 append되므로 중복, 충돌, 출처, 최신성 관리가 어렵다.
8. 확정된 컨텍스트가 새 채팅과 다음 번역·검수·폴리싱에 일관되게 사용되었다는 추적 정보가 없다.

### 1.2 제품 목표

- 전체 번역과 전체 폴리싱은 기존처럼 유지한다.
- Source 선택 영역에서는 질문만 허용하고 재번역/적용 기능은 제공하지 않는다.
- Target 선택 영역에서는 질문과 직접 부분 재번역을 모두 제공한다.
- 선택 채팅은 선택 영역을 우선 근거로 사용하고 불필요한 프로젝트/문서 컨텍스트를 자동 주입하지 않는다.
- 일반 채팅은 문서 조회와 외부 도구를 계속 사용할 수 있다.
- 직접 부분 재번역은 전체 문서 도구를 사용하지 않는다.
- 채팅의 구조화된 수정안을 미리보기 후 원래 선택 위치에 적용할 수 있다.
- 채팅에서 발견된 규칙, 금칙어, 용어, 프로젝트 지식을 분류하여 사용자 승인 후 프로젝트 전체에 유지한다.
- 모든 장기 AI 실행은 시작 시점의 ContextSnapshot을 사용한다.

### 1.3 비목표

초기 버전에서 다음은 구현하지 않는다.

- Source 패널의 선택 영역 번역 또는 재번역
- 여러 문단/목록/표 셀을 가로지르는 선택 영역 치환
- 5,000단어를 크게 초과하는 문서를 위한 벡터 DB, 임베딩 검색, 서버 인덱싱
- 사용자 승인 없는 프로젝트 메모리 자동 저장
- AI 도구가 문서를 직접 수정하는 `apply_*` 도구
- 프로젝트 간 공유 메모리
- 앱 재실행 후 TipTap selection anchor 복원
- 임의의 AI Markdown 응답을 파싱하여 자동 적용

## 2. 현재 구현 기준선

### 2.1 선택 메뉴

- `src/components/editor/EditorCanvasTipTap.tsx`
  - 선택 시 `editor`, `field`, `from`, `to`, `text`, `segmentGroupId`를 캡처한다.
  - 현재 `채팅에 추가`는 선택문과 코멘트를 일반 문자열로 composer에 append한다.
- `src/components/ui/SelectionActionMenu.tsx`
  - 복사, 채팅, 코멘트 메뉴가 있다.
  - 선택 영역 복사 기능은 `dd30ff2`에 반영되어 있다.

이 문서의 코드 기준선은 `dd30ff2` 이후다. 구현 시작 시점에 새 미커밋 변경이 있다면 모두 사용자 작업으로 간주하여 보존하고, 기존 복사 메뉴 위에 최소 diff로 기능을 추가한다.

### 2.2 채팅 컨텍스트

- `src/stores/chatStore.ai.ts`
  - 매 요청마다 `translationRules`, `projectContext`, 매칭 글로서리, context blocks를 구성한다.
  - 세션 전체 transcript는 `planConversationContext()`에서 요약과 최근 원문으로 나뉜다.
- `src/ai/chatContext/conversationContext.ts`
  - 최근 8~12턴과 누적 세션 요약을 사용한다.
- `src/types/index.ts`
  - `ChatSessionMemory`는 세션별 working context이며 프로젝트 전체 메모리가 아니다.

### 2.3 현재 AI 도구

`src/ai/chat.ts`의 `buildToolSpecs()`는 일반 채팅 요청마다 기본적으로 다음 도구를 바인딩한다.

- `get_source_document`
- `get_target_document`
- `get_review_results`
- `suggest_translation_rule`
- `suggest_project_context`

옵션에 따라 웹 검색, Atlassian MCP, Confluence, Notion 도구가 추가된다.

현재 문제:

- 선택 영역 유무와 관계없이 Source/Target 문서 도구가 항상 바인딩된다.
- `buildQuestionSystemPrompt()`가 문서 질문이면 문서 도구를 먼저 호출하도록 강하게 지시한다.
- 도구 정의 자체도 입력 토큰을 사용한다.
- `get_review_results`가 검수 결과 유무와 무관하게 노출된다.
- `confluence_load_page`는 Source 문서를 변경하지만 일반 읽기 도구와 같은 경로로 노출된다.
- 프롬프트는 `range/maxChars`를 안내하지만 실제 문서 도구 스키마는 `query/maxChars/aroundChars`다.
- `TOOL_NAME_MAP`과 실제 동적 도구 목록이 분리되어 UI 표시명이 누락될 수 있다.

### 2.4 현재 Project Context

- `translationRules`와 `projectContext`는 `chat_project_settings.settings_json`에 프로젝트별로 저장된다.
- 채팅의 `Add to Rules`, `Add to Context` 버튼으로 append할 수 있다.
- 전체 번역, 검수, 폴리싱이 두 값을 사용한다.
- 새 채팅도 같은 프로젝트라면 값을 공유한다.
- `translationContextSessionId`는 저장/복원되지만 실제 번역 페이로드에서 소비되는 호출부가 없다. 새 설계의 기반으로 사용하지 말고 제거 또는 deprecated 처리 여부를 별도 결정한다.

현재 Project Context는 하나의 문자열이므로 구조화된 중복 제거, 충돌 처리, 출처 추적, 항목별 활성/보관 처리가 불가능하다.

### 2.5 현재 장기 실행의 컨텍스트 일관성

- 전체 번역과 폴리싱은 실행 시작 시 컴포넌트가 가진 규칙/컨텍스트를 전달한다.
- 검수는 각 청크 처리 시 `useChatStore.getState()`로 최신 규칙/컨텍스트를 다시 읽는다.

동적 컨텍스트 도입 후 검수가 진행되는 중간에 컨텍스트가 바뀌면 앞 청크와 뒤 청크가 서로 다른 기준을 사용할 수 있다. 검수 시작 시 한 번 만든 ContextSnapshot을 모든 청크에 전달하도록 변경해야 한다.

## 3. 설계 불변식

구현 중 다음 조건을 깨뜨리지 않는다.

1. AI는 사용자 확인 없이 Source/Target 문서를 변경하지 않는다.
2. 직접 부분 재번역도 반드시 미리보기를 거친다.
3. TipTap JSON이 문서의 canonical representation이다.
4. 부분 적용은 ProseMirror transaction으로 실행되어 Undo가 가능해야 한다.
5. 선택 위치는 텍스트 재검색이 아니라 TipTap mapping 가능한 anchor로 추적한다.
6. 동일 문구가 여러 번 등장해도 원래 선택 범위만 수정한다.
7. 선택 영역 자체가 변경되면 stale로 처리하고 적용을 막는다.
8. 프로젝트가 전환되거나 문서 전체가 교체되면 이전 selection proposal을 적용하지 않는다.
9. 직접 부분 재번역에는 AI 도구를 하나도 바인딩하지 않는다.
10. 선택 채팅에는 현재 profile에 허용된 최소 도구만 바인딩한다.
11. 프로젝트 메모리는 사용자 승인 후에만 active가 된다.
12. 규칙, 금칙어, 용어집, 프로젝트 배경지식을 서로 다른 데이터 종류로 유지한다.
13. 장기 실행은 시작 시점의 ContextSnapshot을 끝까지 사용한다.
14. AI 요청 metadata에 실제 사용한 컨텍스트와 도구를 기록한다.

## 4. 목표 UX

### 4.1 Source 선택 메뉴

메뉴:

- 복사
- 채팅으로 질문
- 코멘트 추가/보기

제공하지 않음:

- 선택 영역 재번역
- 선택 영역에 AI 수정안 적용

Source 선택을 채팅에 첨부하면 composer에 raw text를 붙이지 않고 선택 카드로 표시한다.

```text
Source · 148자
“The service remains unavailable until…”
```

Source 선택 채팅은 의미, 용어, 맥락, 해석 질문을 지원한다.

### 4.2 Target 선택 메뉴

메뉴:

- 복사
- 채팅으로 질문
- 선택 영역 재번역
- 코멘트 추가/보기

Target 선택 카드는 다음처럼 표시한다.

```text
Target · 92자
“서비스는 다음 점검이 완료될 때까지…”
```

### 4.3 선택 영역 채팅

선택 카드는 다음 상태를 가진다.

- active: 문서 위치가 유효함
- stale: 선택 범위 자체가 바뀜
- detached: 앱 재실행 또는 문서 교체로 anchor가 없음
- applied: 연결된 수정안이 적용됨
- dismissed: 사용자가 선택 범위를 해제함

같은 선택 영역에서 이어지는 대화에는 `selectionScopeId`를 부여한다. 새 영역을 선택하면 같은 채팅 화면 안에서도 새 scope가 시작된다.

화면에는 이전 대화가 계속 보이지만 모델 입력은 다음을 우선 사용한다.

- 현재 selection scope의 대화
- 현재 사용자 질문
- 필요 시 프로젝트 메모리/문서 도구

다른 selection scope의 대화는 현재 모델 입력에서 제외한다.

### 4.4 직접 선택 영역 재번역

Target 선택 후 작은 팝오버 또는 모달을 연다.

필수 입력:

- 선택한 Target
- 연결된 Source 번역 단위
- 추가 지시문

선택 가능한 컨텍스트:

- 번역 규칙 참조
- 금칙어 참조
- 용어집 참조
- 프로젝트 컨텍스트 참조

기본값은 모두 OFF로 한다.

대응 Source는 재번역의 필수 데이터이므로 체크박스와 무관하게 포함한다. 대응 Source를 찾지 못하면 재번역을 실행하지 않고 “연결된 원문을 찾을 수 없습니다”를 표시한다.

### 4.5 채팅 수정안 적용

AI가 단순 답변만 한 경우 적용 버튼을 표시하지 않는다.

AI가 `propose_selection_edit`를 호출한 경우:

```text
수정안
“서비스는 점검이 완료될 때까지 이용할 수 없습니다.”

[미리보기] [폐기]
```

미리보기에서 원문/수정안 diff를 확인한 뒤 적용한다.

AI가 일반 prose로 수정안을 썼지만 구조화된 proposal이 없다면 자동 파싱하지 않는다. 대신 `수정안 만들기` 버튼으로 구조화된 후속 요청을 보낸다.

### 4.6 동적 프로젝트 메모리

대화에서 장기적으로 유지할 지식이 발견되면 AI가 변경 카드를 제안한다.

```text
프로젝트 메모리 업데이트 제안

분류: 독자층
기존: 일반 사용자
변경: 엔터프라이즈 IT 관리자

[업데이트] [새 항목으로 추가] [무시]
```

사용자 승인 후 active가 되며 다음 새 채팅과 다음 번역·검수·폴리싱부터 적용된다.

## 5. 컨텍스트 계층

컨텍스트를 다음 네 계층으로 분리한다.

| 계층 | 수명 | 자동 갱신 | 다른 채팅/워크플로 재사용 |
|---|---|---:|---:|
| Selection Context | 단일 선택/scope | 위치만 자동 mapping | 기본적으로 없음 |
| Chat Working Memory | 채팅 세션 | 자동 요약 | 없음 |
| Project Memory | 프로젝트 | AI 제안 + 사용자 승인 | 있음 |
| Translation Constraints | 프로젝트 | 사용자 승인 | 있음 |

Translation Constraints:

- Translation Rules
- Forbidden Terms
- Glossary

Project Memory:

- domain
- audience
- product
- worldbuilding
- character
- intent
- decision
- reference fact

규칙성 문장을 Project Memory에 넣지 않는다.

예시 분류:

| 사용자 발화 | 저장 위치 |
|---|---|
| “앞으로 합니다체로 써” | Translation Rule |
| “블랙리스트라는 말은 쓰지 마” | Forbidden Term |
| “Workspace는 작업 공간으로 번역해” | Glossary |
| “이 문서는 IT 관리자를 위한 릴리스 노트야” | Project Memory/audience |
| “Alice는 제품명이 아니라 등장인물이야” | Project Memory/character |

## 6. 데이터 모델

### 6.1 선택 컨텍스트

```ts
export type SelectionPanel = "source" | "target";

export type SelectionAnchorStatus =
  | "active"
  | "stale"
  | "detached"
  | "applied"
  | "dismissed";

export interface SelectionContext {
  selectionId: string;
  selectionScopeId: string;
  projectId: string;
  panel: SelectionPanel;
  text: string;
  from: number;
  to: number;
  anchorId: string;
  translationUnitIds: string[];
  segmentGroupId?: string;
  documentRevision: string;
  status: SelectionAnchorStatus;
  createdAt: number;
}
```

주의:

- `Editor` 인스턴스는 Zustand persist 대상에 넣지 않는다.
- runtime anchor는 TipTap plugin state가 관리한다.
- ChatMessage에는 selection snapshot을 저장할 수 있지만 runtime `from/to`가 앱 재실행 후 유효하다고 가정하지 않는다.

### 6.2 선택 메시지 snapshot

```ts
export interface ChatSelectionSnapshot {
  selectionId: string;
  selectionScopeId: string;
  projectId: string;
  panel: SelectionPanel;
  text: string;
  translationUnitIds: string[];
  documentRevision: string;
  anchorStatusAtSend: SelectionAnchorStatus;
}
```

### 6.3 컨텍스트 체크박스

```ts
export interface ContextReferenceOptions {
  translationRules: boolean;
  forbiddenTerms: boolean;
  glossary: boolean;
  projectContext: boolean;
}
```

직접 부분 재번역 기본값:

```ts
const DEFAULT_SELECTION_REFERENCE_OPTIONS: ContextReferenceOptions = {
  translationRules: false,
  forbiddenTerms: false,
  glossary: false,
  projectContext: false,
};
```

### 6.4 수정안

```ts
export interface SelectionEditProposal {
  proposalId: string;
  selectionId: string;
  selectionScopeId: string;
  projectId: string;
  panel: "target";
  anchorId: string;
  originalText: string;
  replacementText: string;
  explanation?: string;
  operation: "translate" | "polish" | "rewrite";
  documentRevisionAtRequest: string;
  contextManifest?: ContextManifest;
  status: "proposed" | "previewing" | "applied" | "stale" | "dismissed";
  createdAt: number;
  appliedAt?: number;
}
```

### 6.5 Project Memory

```ts
export type ProjectMemoryCategory =
  | "domain"
  | "audience"
  | "product"
  | "worldbuilding"
  | "character"
  | "intent"
  | "decision"
  | "reference_fact"
  | "general";

export type ProjectMemoryStatus = "proposed" | "active" | "archived";

export interface ProjectMemoryItem {
  id: string;
  projectId: string;
  category: ProjectMemoryCategory;
  content: string;
  normalizedHash: string;
  status: ProjectMemoryStatus;
  source: "user" | "chat" | "review" | "import" | "legacy";
  sourceSessionId?: string;
  sourceMessageId?: string;
  sourceSelectionId?: string;
  supersedesId?: string;
  createdAt: number;
  updatedAt: number;
}
```

내용 변경은 가능하면 기존 row를 덮어쓰지 않는다.

- 기존 항목을 archived 처리한다.
- 새 항목을 생성한다.
- `supersedesId`로 연결한다.

이 방식이면 과거 ContextSnapshot이 참조한 항목을 재현할 수 있다.

### 6.6 금칙어

```ts
export interface ForbiddenTerm {
  id: string;
  projectId: string;
  term: string;
  replacement?: string;
  note?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### 6.7 ContextSnapshot과 manifest

`ContextSnapshot`은 장기 실행 중 입력이 바뀌지 않도록 메모리에 보관하는 runtime 객체다. 실제로 모델에 전달할 문자열과 구조화 항목을 실행 시작 시 복사한다.

```ts
export interface ContextSnapshot {
  revision: number;
  projectMemoryItems: Array<Pick<
    ProjectMemoryItem,
    "id" | "category" | "content"
  >>;
  translationRules: string;
  forbiddenTerms: Array<Pick<
    ForbiddenTerm,
    "id" | "term" | "replacement" | "note"
  >>;
  glossaryEntries: Array<{
    id: string;
    source: string;
    target: string;
  }>;
  createdAt: number;
}

export interface ContextManifest {
  mode:
    | "general-chat"
    | "selection-chat"
    | "full-translate"
    | "selection-retranslate"
    | "review"
    | "polish";
  revision: number;
  projectMemoryItemIds: string[];
  translationRulesHash?: string;
  forbiddenTermIds: string[];
  glossaryEntryIds: string[];
  included: Array<
    | "selection"
    | "aligned-source"
    | "translation-rules"
    | "forbidden-terms"
    | "glossary"
    | "project-memory"
    | "chat-summary"
    | "document-tool"
    | "external-tool"
  >;
  estimatedInputTokens?: number;
}
```

`ContextManifest`는 ChatMessage, proposal, history에 저장하는 경량 감사 정보다. runtime snapshot의 전체 문자열을 채팅 transcript마다 복제하지 않는다.

resolver 반환 계약:

```ts
export interface ResolvedWorkflowContext {
  snapshot: ContextSnapshot;
  manifest: ContextManifest;
  rendered: {
    projectMemory?: string;
    translationRules?: string;
    forbiddenTerms?: string;
    glossary?: string;
  };
}
```

검수처럼 여러 청크를 순차 처리하는 작업은 첫 청크 전에 `ResolvedWorkflowContext`를 한 번 만들고 이후 모든 청크에 같은 객체를 전달한다.

### 6.8 ChatMessageMetadata 확장

```ts
export interface ChatMessageMetadata {
  // 기존 필드 유지
  selection?: ChatSelectionSnapshot;
  selectionScopeId?: string;
  documentEditProposal?: SelectionEditProposal;
  contextManifest?: ContextManifest;
  projectMemoryProposal?: ProjectMemoryChangeProposal;
}
```

### 6.9 Project Memory 변경 제안

```ts
export interface ProjectMemoryChangeProposal {
  proposalId: string;
  operation: "add" | "replace" | "archive";
  category: ProjectMemoryCategory;
  content?: string;
  targetItemId?: string;
  reason?: string;
  sourceSessionId: string;
  sourceMessageId?: string;
  status: "proposed" | "applied" | "dismissed";
}
```

## 7. TipTap selection anchor 설계

### 7.1 새 확장

파일:

```text
src/editor/extensions/SelectionAnchor.ts
```

ProseMirror `Plugin`과 `DecorationSet`을 사용한다.

plugin state:

```ts
interface SelectionAnchorRecord {
  anchorId: string;
  from: number;
  to: number;
  originalText: string;
  status: SelectionAnchorStatus;
  createdAt: number;
}
```

commands:

```ts
createSelectionAnchor(args): string;
removeSelectionAnchor(anchorId: string): boolean;
resolveSelectionAnchor(anchorId: string): SelectionAnchorRecord | null;
markSelectionAnchorStale(anchorId: string): boolean;
clearSelectionAnchors(): boolean;
```

### 7.2 transaction mapping

모든 document transaction에서:

1. 기존 `from/to`를 `tr.mapping.map()`으로 이동한다.
2. mapping 후 범위가 유효한지 검사한다.
3. 현재 범위 text를 읽는다.
4. 현재 text가 originalText와 같으면 active 유지한다.
5. 선택 범위 자체가 바뀌었으면 stale로 전환한다.
6. 범위가 삭제되거나 문서 전체 교체 meta가 있으면 detached/stale 처리한다.

선택 범위 앞이나 뒤가 수정된 것은 stale로 만들지 않는다.

### 7.3 anchor 수명

- 새 selection scope 생성 시 anchor 생성
- proposal 적용 또는 폐기 시 필요 없는 anchor 제거
- 세션당 active anchor 수를 제한한다. 권장 상한은 5개다.
- 프로젝트 전환, editor destroy, 전체 document replace 시 모두 clear한다.
- 앱 재실행 후 transcript의 selection snapshot은 유지하지만 anchor는 detached다.

### 7.4 초기 선택 제한

MVP에서는 다음 범위만 허용한다.

- `from < to`
- 같은 textblock 내부
- Target 재번역 시 1개 이상의 `translationUnitId`를 해석 가능

`rangeCrossesBlockBoundary()`를 재사용하거나 동일한 same-parent 기준을 사용한다.

### 7.5 인라인 formatting

선택 범위의 모든 text node가 공유하는 mark intersection을 계산한다.

- 공통 mark가 있으면 replacement text에 적용한다.
- mixed marks면 미리보기에 formatting 단순화 경고를 표시한다.
- 링크 전체가 선택된 경우에만 link mark를 유지한다.
- code 영역은 MVP에서 재번역을 막는 것이 안전하다.

## 8. Source/Target 번역 단위 연결

### 8.1 translationUnitId

Source/Target의 대응 단위에 안정적인 ID를 부여한다.

대상 노드:

- paragraph
- heading
- listItem 또는 그 내부 대표 paragraph
- tableCell

새 TipTap global attribute 또는 확장:

```text
src/editor/extensions/TranslationUnitId.ts
```

속성:

```ts
translationUnitId?: string;
```

HTML persistence가 필요한 경우 `data-translation-unit-id`로 serialize/parse한다.

### 8.2 ID 생성

- Source import/입력 시 ID 없는 번역 단위에 UUID를 부여한다.
- Source block split 시 새 단위에 새 ID를 부여한다.
- Source block join 시 유지할 ID를 결정하고 다른 ID 연결은 무효화한다.
- Target의 신규 수동 block은 연결되지 않은 새 ID 또는 `unmapped` 상태를 가진다.

### 8.3 전체 번역 후 연결

LLM에게 ID 보존을 맡기지 않는다.

1. 번역 전 Source translatable unit의 구조 경로와 ID를 수집한다.
2. AI에는 ID가 제거된 Markdown을 전달한다.
3. 번역 결과 TipTap JSON을 생성한다.
4. Source와 Target의 topology/type/order를 검증한다.
5. 대응 가능한 Target unit에 Source unit ID를 재부착한다.
6. 불일치 단위는 unaligned로 기록한다.

기존 전체 번역 프롬프트의 topology 보존 규칙을 활용한다.

### 8.4 폴리싱 후 연결

폴리싱 전 Target unit path/ID를 수집하고 결과 topology가 같으면 동일 ID를 재부착한다.

### 8.5 fallback

우선순위:

1. `translationUnitId`
2. 유효한 `segmentGroupId`
3. 동일 topology path/order
4. 실패

텍스트 fuzzy search로 대응 Source를 임의 선택하지 않는다.

## 9. 채팅 모드와 Tool Profile

### 9.1 요청 모드

```ts
export type ChatContextMode =
  | "general"
  | "selection"
  | "document";

export type ChatToolProfile =
  | "general"
  | "selection-source"
  | "selection-target"
  | "selection-retranslate";
```

`sendMessage()` 계약:

```ts
interface SendMessageOptions {
  targetSessionId?: string;
  contextMode?: ChatContextMode;
  selection?: SelectionContext;
  selectionScopeId?: string;
}

sendMessage(content: string, options?: SendMessageOptions): Promise<void>;
```

기존 `sendMessage(content, targetSessionId?)` 호출부를 모두 마이그레이션하거나 overload adapter를 잠시 유지한다.

### 9.2 Tool Registry

파일 제안:

```text
src/ai/tools/toolRegistry.ts
src/ai/tools/resolveChatTools.ts
```

```ts
interface ChatToolDescriptor {
  name: string;
  profiles: ChatToolProfile[];
  effect: "read" | "external-read" | "proposal" | "document-write";
  trust: "internal" | "document" | "external";
  maxOutputChars: number;
  displayNameKey: string;
  requires?: Array<
    | "project"
    | "source-selection"
    | "target-selection"
    | "review-results"
    | "web-enabled"
    | "confluence-enabled"
    | "notion-enabled"
    | "explicit-document-reference"
    | "explicit-external-reference"
  >;
}
```

registry에서 다음을 생성한다.

- 실제 toolSpecs
- bindTools
- boundToolNames
- system tool guide
- UI 표시명
- trust boundary wrapping
- output size limit

`INTERNAL_TOOLS`, `TOOL_NAME_MAP`, 동적 가이드의 수동 중복을 줄인다.

### 9.3 도구 매트릭스

| 도구 | general | selection-source | selection-target | selection-retranslate |
|---|---:|---:|---:|---:|
| get_source_document | 조건부 | 명시적 확장만 | 명시적 확장만 | 금지 |
| get_target_document | 조건부 | 금지/명시적 비교만 | 명시적 확장만 | 금지 |
| get_selection_surroundings | - | 허용 | 허용 | 금지 |
| get_aligned_selection_context | - | 금지 | 허용 | 금지 |
| get_review_results | 결과/질문 있을 때 | 조건부 | 조건부 | 금지 |
| get_project_guidance | 허용 | 조건부 | 조건부 | 금지 |
| search_project_glossary | 허용 | 조건부 | 조건부 | 금지 |
| propose_selection_edit | 금지 | 금지 | 허용 | 금지 |
| propose_project_memory_change | 허용 | 허용 | 허용 | 금지 |
| suggest_translation_rule | 허용 | 허용 | 허용 | 금지 |
| suggest_forbidden_term | 허용 | 허용 | 허용 | 금지 |
| suggest_glossary_entry | 허용 | 허용 | 허용 | 금지 |
| web/Confluence/Notion | 사용자 gate | 명시적 요청만 | 명시적 요청만 | 금지 |
| confluence_load_page | 명시적 import 의도 | 금지 | 금지 | 금지 |

### 9.4 새 읽기 도구

#### get_selection_surroundings

현재 요청의 selection을 closure로 캡처한다.

```ts
{
  beforeUnits?: 0 | 1 | 2;
  afterUnits?: 0 | 1 | 2;
}
```

모델이 projectId, from, to를 지정하지 못하게 한다.

#### get_aligned_selection_context

Target selection에 대응하는 Source와 선택적 주변 단위를 반환한다.

```ts
{
  beforeUnits?: 0 | 1 | 2;
  afterUnits?: 0 | 1 | 2;
}
```

반환:

```ts
{
  source: string;
  target: string;
  unitIds: string[];
  truncated: boolean;
  documentRevision: string;
}
```

#### get_project_guidance

```ts
{
  sections: Array<
    "translation_rules" |
    "forbidden_terms" |
    "project_memory"
  >;
  query?: string;
}
```

glossary는 별도 검색 도구를 사용한다.

#### search_project_glossary

```ts
{
  query: string;
  limit?: number; // clamp 1..12
}
```

### 9.5 proposal 도구

#### propose_selection_edit

```ts
{
  replacementText: string;
  explanation?: string;
  operation?: "translate" | "polish" | "rewrite";
}
```

도구 함수는 문서를 수정하지 않고 `{ ok: true }` 같은 짧은 결과만 반환한다. 실제 proposal metadata는 `onToolCall(start)`의 args와 요청 closure에서 구성한다.

#### propose_project_memory_change

```ts
{
  operation: "add" | "replace" | "archive";
  category: ProjectMemoryCategory;
  content?: string;
  targetItemId?: string;
  reason?: string;
}
```

#### suggest_forbidden_term

```ts
{
  term: string;
  replacement?: string;
  note?: string;
}
```

#### suggest_glossary_entry

기존 glossary schema와 일치시킨다. 실제 저장은 사용자가 승인한 뒤 기존 glossary store/command를 호출한다.

### 9.6 기존 도구 변경

`get_source_document`, `get_target_document`:

```ts
{
  unitIds?: string[];
  query?: string;
  maxChars?: number;
  aroundChars?: number;
}
```

조회 우선순위:

1. unitIds
2. 현재 selection 주변
3. query
4. 명시적 전체 문서

query를 찾지 못했을 때 선택 채팅에서 head/tail을 근거로 반환하지 않는다.

`get_review_results`:

- 검수 결과가 있을 때만 바인딩
- 검수/이슈 관련 의도가 있을 때 우선 노출

Confluence/MCP:

- 서버가 반환한 도구 전체를 무조건 노출하지 않는다.
- allowlist 또는 effect 분류를 통과한 도구만 registry에 넣는다.
- `confluence_load_page`는 write effect로 분류하고 명시적 import 요청에서만 바인딩한다.

### 9.7 도구 루프

- general: 기본 maxSteps 6, cap 12 유지
- selection chat: 기본 maxSteps 4
- selection retranslate: tool loop 없음
- proposal과 context read가 동시에 필요한 경우 read 결과를 받은 다음 step에서 proposal을 생성하도록 프롬프트에 명시한다.

## 10. 선택 채팅 컨텍스트 조립

### 10.1 기본 selection payload

```text
System:
  selection profile 지침
  현재 선택 metadata

History:
  동일 selectionScopeId의 최근 대화/요약

Human:
  현재 질문
```

포함하지 않음:

- 전체 Source
- 전체 Target
- 다른 selection scope 대화
- translationRules 전체
- projectContext 전체
- glossary 전체
- 활성화만 되었을 뿐 이번 질문과 무관한 외부 tool schema

### 10.2 selection prompt

Target 예시:

```text
현재 Target 선택 영역이 이 요청의 우선 근거입니다.
선택 영역만으로 답할 수 있으면 문서 도구를 호출하지 마세요.
원문 대조가 필요할 때만 get_aligned_selection_context를 호출하세요.
전체 문서 비교는 사용자가 명시적으로 요구한 경우에만 수행하세요.
문서에 적용 가능한 수정안을 제안할 때는 propose_selection_edit를 사용하세요.
propose_selection_edit는 문서를 변경하지 않으며 사용자가 별도로 승인합니다.
```

Source 예시:

```text
현재 Source 선택 영역이 이 요청의 우선 근거입니다.
Source 선택에는 수정안 적용 도구가 없습니다.
질문에 답하되 Target 문서를 변경했다고 말하지 마세요.
```

### 10.3 scope history

ChatMessage metadata의 `selectionScopeId`로 priorMessages를 필터링한다.

- 동일 scope의 user/assistant 메시지
- scope 생성 이전의 프로젝트 관련 공통 대화는 기본 제외
- 프로젝트에서 승인된 장기 지식은 Project Memory로 따로 제공
- 새 selection scope 시작 시 기존 세션 summary를 그대로 주입하지 않는다.

scope별 summary가 필요하면 `ChatSelectionScopeMemory`를 추가할 수 있다.

```ts
interface ChatSelectionScopeMemory {
  selectionScopeId: string;
  summary: string;
  summarizedThroughMessageId: string | null;
}
```

MVP에서는 동일 scope 최근 8~12턴만 유지하고 scope별 요약은 후속 단계로 미룰 수 있다.

### 10.4 Context Manifest UI

assistant 메시지 하단 또는 tooltip:

```text
참조: 선택 영역 · 연결된 원문
도구: get_aligned_selection_context
입력: 1,240 tokens
```

전체 문서를 쓰지 않은 요청에는 “전체 문서 미참조”를 표시할 수 있다.

## 11. 직접 선택 재번역

### 11.1 전용 모듈

```text
src/ai/retranslateSelection.ts
```

계약:

```ts
interface RetranslateSelectionInput {
  projectId: string;
  sourceText: string;
  currentTargetText: string;
  targetLanguage: string;
  instruction?: string;
  referenceOptions: ContextReferenceOptions;
  contextSnapshot: ContextSnapshot;
  translationRules?: string;
  forbiddenTerms?: ForbiddenTerm[];
  glossary?: string;
  projectMemory?: string;
  abortSignal?: AbortSignal;
  onToken?: (text: string) => void;
}
```

반환:

```ts
interface RetranslateSelectionResult {
  replacementText: string;
  contextManifest: ContextManifest;
}
```

### 11.2 프롬프트

- Source 의미 보존
- 현재 Target은 개선 대상 참고
- 선택 범위 밖 문장 출력 금지
- 설명/인사 금지
- 체크되지 않은 컨텍스트는 존재한다고 가정하지 않음
- 금칙어 위반 금지
- 구조적 marker 또는 provider structured output 사용

스트리밍 호환을 위해 marker 방식을 사용할 수 있다.

```text
---SELECTION_EDIT_START---
[replacement only]
---SELECTION_EDIT_END---
```

### 11.3 도구

`retranslateSelection()`은 `buildToolSpecs()`와 `runToolCallingLoop()`를 호출하지 않는다.

Dry-run 완료 조건:

```text
bound tools: 0
initial source chars: mapped selection source only
initial target chars: selected target only
unchecked context chars: 0
```

## 12. 수정안 미리보기와 적용

### 12.1 전용 모달

```text
src/components/editor/SelectionEditPreviewModal.tsx
```

전체 문서용 `TranslatePreviewModal`을 재사용하지 않는다.

표시:

- 선택 원문
- replacement
- inline diff
- 사용된 컨텍스트 배지
- stale/error 경고
- 적용/취소

### 12.2 적용 전 검증

1. 현재 projectId가 proposal projectId와 같은가
2. anchor가 존재하는가
3. anchor status가 active인가
4. 현재 anchor text가 proposal.originalText와 같은가
5. Target editor가 등록되어 있는가
6. 범위가 같은 textblock 안인가
7. 문서가 전체 replace되지 않았는가

하나라도 실패하면 적용하지 않고 재선택을 요구한다.

### 12.3 transaction

새 유틸리티 제안:

```text
src/editor/utils/applySelectionEdit.ts
```

```ts
applySelectionEdit(
  editor: Editor,
  anchor: SelectionAnchorRecord,
  replacementText: string,
): "applied" | "stale" | "invalid";
```

ProseMirror transaction 하나로 replace한다. 적용 후:

- editor focus
- 교체 범위 selection
- anchor applied 처리/제거
- proposal applied 처리
- 일반 editor sync/save 경로 사용
- Undo 1회로 원복 가능

### 12.4 history

선택 적용마다 전체 문서 snapshot을 무조건 생성하면 이력이 과도해질 수 있다.

권장:

- TipTap Undo는 적용마다 생성
- 프로젝트 history snapshot은 사용자가 저장할 때 기존 방식 유지
- 자동 history가 필요하면 3~5분 안의 연속 부분 편집을 하나로 coalesce

MVP에서는 별도 자동 history를 추가하지 않아도 된다.

## 13. 동적 Project Memory

### 13.1 저장소

문자열 하나보다 SQLite 구조화 테이블을 권장한다.

```sql
CREATE TABLE IF NOT EXISTS project_memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  source_session_id TEXT,
  source_message_id TEXT,
  source_selection_id TEXT,
  supersedes_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_memory_project_status
  ON project_memory_items(project_id, status);

CREATE TABLE IF NOT EXISTS project_memory_state (
  project_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

금칙어:

```sql
CREATE TABLE IF NOT EXISTS forbidden_terms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  term TEXT NOT NULL,
  replacement TEXT,
  note TEXT,
  enabled INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### 13.2 store

새 store 제안:

```text
src/stores/projectMemoryStore.ts
```

책임:

- project hydrate/clear
- active/proposed/archived 목록
- add/replace/archive
- revision 증가
- legacy migration
- context resolver 입력 제공

Forbidden terms는 Project Memory와 다른 도메인이므로 별도 slice/store 또는 project settings store에 둔다.

### 13.3 legacy migration

기존 `chat_project_settings.projectContext`를 즉시 삭제하지 않는다.

마이그레이션:

1. project memory row가 없고 legacy projectContext가 비어 있지 않은지 확인
2. legacy 문자열을 `category: general`, `source: legacy`, `status: active` 항목으로 생성
3. migration marker 또는 state revision 저장
4. 기존 API 호환을 위해 transition 기간 동안 derived string adapter 제공
5. 새 writer는 구조화 메모리에 기록

기존 `translationRules`는 그대로 유지한다.

Desktop MCP `get/set_translation_context`와의 호환:

- 초기 구현에서는 기존 `projectContext: string` 계약을 adapter로 유지한다.
- 외부 MCP schema를 바꾸면 `oddeyes-desktop-mcp` package/manifest/tools 목록/`.mcpb`/npm 배포까지 동기화해야 한다.
- 이 기능 구현만으로 Desktop MCP 변경을 필수화하지 않는다.

### 13.4 제안/승인

AI는 proposal만 만든다.

`add`:

- exact normalized hash 중복이면 기존 항목 표시
- 유사 category 항목이 있으면 replace/add 선택 제공

`replace`:

- target item을 archived
- 새 item 생성
- supersedesId 연결
- revision 증가

`archive`:

- active item을 archived
- revision 증가

### 13.5 dedupe/conflict

5,000단어 규모에서는 embedding/vector search를 도입하지 않는다.

MVP:

1. trim/lowercase/whitespace normalize
2. normalized hash exact match
3. 같은 category 내 단순 token similarity
4. 충돌 가능 항목을 사용자에게 함께 표시

AI가 임의로 기존 항목을 덮어쓰지 않는다.

## 14. Workflow별 Context Resolver

파일 제안:

```text
src/ai/context/resolveWorkflowContext.ts
src/ai/context/buildContextSnapshot.ts
```

계약:

```ts
type WorkflowContextMode =
  | "general-chat"
  | "selection-chat"
  | "full-translate"
  | "selection-retranslate"
  | "review"
  | "polish";

interface ResolveWorkflowContextInput {
  projectId: string;
  mode: WorkflowContextMode;
  queryText?: string;
  sourceText?: string;
  targetText?: string;
  referenceOptions?: ContextReferenceOptions;
}
```

### 14.1 일반 채팅

- 새 채팅에서도 Project Memory는 유지된다.
- 핵심 active memory를 짧게 제공하거나 `get_project_guidance`로 on-demand 조회한다.
- 전체 raw Project Context를 매 턴 반복 주입하지 않는다.
- Translation Rules가 질문과 무관하면 on-demand로 전환할 수 있다.

MVP 전환 전략:

1. general chat은 기존 자동 주입을 유지
2. selection chat부터 최소 주입 적용
3. 관측 데이터 확보 후 general chat도 compact summary + tool 방식으로 전환

### 14.2 선택 채팅

- 기본: selection만 포함
- Project Memory는 명시적 요청 또는 tool call
- glossary도 `search_project_glossary`로 필요할 때만
- 현재 scope history만 포함

### 14.3 전체 번역

- active Project Memory 중 domain/audience/product/worldbuilding/character/decision
- Translation Rules
- enabled Forbidden Terms
- Source 전역 매칭 Glossary
- 실행 시작 시 ContextSnapshot 생성

### 14.4 검수

- 전체 번역과 같은 constraints
- review 시작 시 한 번 snapshot
- 모든 chunk에 동일 snapshot/rendered context 사용
- 현재 청크마다 최신 store 값을 읽는 코드 제거

### 14.5 폴리싱

우선 포함:

- audience
- domain
- product
- character tone
- decision
- Translation Rules
- enabled Forbidden Terms
- 관련 Glossary

Project Memory의 사실을 Target에 새로 추가하지 않도록 기존 프롬프트 방어를 유지한다.

### 14.6 선택 재번역

- Source/Target selection은 항상
- 네 checkbox가 켜진 항목만 추가
- context snapshot에는 실제 포함된 item/term/glossary ID만 기록

### 14.7 snapshot 동시성

- 요청 시작 시 snapshot 생성
- 실행 중 memory가 변경되어도 해당 요청은 기존 snapshot 유지
- 다음 요청부터 새 revision 사용
- 프로젝트 전환 시 in-flight 결과 폐기

## 15. 상태 관리 변경

### 15.1 chatStore

추가 state:

```ts
composerSelection: SelectionContext | null;
activeSelectionScopeIdBySession: Record<string, string | null>;
```

추가 actions:

```ts
setComposerSelection(selection: SelectionContext | null): void;
clearComposerSelection(): void;
setActiveSelectionScope(sessionId: string, scopeId: string | null): void;
```

선택 runtime 위치는 TipTap plugin에 있고 store에는 serializable snapshot만 둔다.

### 15.2 replay/edit/delete

- selection metadata를 가진 user message replay 시 anchor가 detached면 적용 도구를 바인딩하지 않는다.
- 텍스트 질문은 다시 실행할 수 있지만 selection은 snapshot reference로만 제공한다.
- 메시지 편집 후 뒤 대화 truncate 시 연결 proposal도 함께 제거/무효화한다.

### 15.3 persistence

- ChatMessage selection snapshot/proposal/context manifest는 JSON에 저장 가능하다.
- runtime anchor는 저장하지 않는다.
- 재실행 후 proposal은 detached/stale로 표시한다.

## 16. UI 변경 파일

### 기존 파일

- `src/components/editor/EditorCanvasTipTap.tsx`
  - selection context 생성
  - anchor 생성
  - Target 재번역 진입
  - preview/apply wiring
- `src/components/ui/SelectionActionMenu.tsx`
  - `onRetranslateSelection?`
  - Source/Target별 조건부 메뉴
- `src/components/chat/ChatContent.tsx`
  - selection chip
  - send options
  - context manifest
  - proposal callbacks
- `src/components/chat/ChatMessageItem.tsx`
  - selection snapshot 표시
  - 수정안 카드
  - project memory proposal 카드
- `src/components/panels/SettingsContent.tsx`
  - 구조화 Project Memory
  - Forbidden Terms 관리
- `src/stores/chatStore.types.ts`
- `src/stores/chatStore.ai.ts`
- `src/stores/chatStore.settings.ts`
- `src/stores/chatStore.persist.ts`
- `src/stores/chatStore.session.ts`
- `src/types/index.ts`
- `src/ai/chat.ts`
- `src/ai/prompt.ts`
- `src/ai/tools/documentTools.ts`
- `src/ai/tools/suggestionTools.ts`
- `src/components/review/ReviewPanel.tsx`
- `src/ai/translateDocument.ts`
- `src/ai/polishDocument.ts`
- `src/ai/review/runReview.ts`
- `src/i18n/locales/ko.json`
- `src/i18n/locales/en.json`

### 새 파일 제안

```text
src/editor/extensions/SelectionAnchor.ts
src/editor/extensions/SelectionAnchor.test.ts
src/editor/extensions/TranslationUnitId.ts
src/editor/extensions/TranslationUnitId.test.ts
src/editor/utils/applySelectionEdit.ts
src/editor/utils/applySelectionEdit.test.ts

src/ai/retranslateSelection.ts
src/ai/retranslateSelection.test.ts
src/ai/context/buildContextSnapshot.ts
src/ai/context/resolveWorkflowContext.ts
src/ai/context/resolveWorkflowContext.test.ts
src/ai/tools/toolRegistry.ts
src/ai/tools/resolveChatTools.ts
src/ai/tools/resolveChatTools.test.ts
src/ai/tools/selectionTools.ts
src/ai/tools/projectMemoryTools.ts

src/components/editor/SelectionEditPreviewModal.tsx
src/components/editor/SelectionEditPreviewModal.test.tsx
src/components/chat/SelectionContextChip.tsx
src/components/chat/SelectionEditProposalCard.tsx
src/components/chat/ProjectMemoryProposalCard.tsx

src/stores/projectMemoryStore.ts
src/stores/projectMemoryStore.test.ts

src/tauri/projectMemory.ts
src-tauri/src/commands/project_memory.rs
```

## 17. 구현 단계

각 단계는 독립적으로 typecheck/test를 통과해야 한다.

### Phase 0 — 기준선 보존

- [ ] `git status --short` 기록
- [ ] 기준 커밋 `dd30ff2` 이후 변경과 새 미커밋 작업을 읽고 보존
- [ ] 현재 관련 테스트 실행
- [ ] 선택 메뉴 변경과 새 기능 diff를 섞지 않도록 주의

검증:

```bash
npm run test:run -- \
  src/components/ui/SelectionActionMenu.test.tsx \
  src/ai/prompt.test.ts \
  src/ai/chat.toolContext.test.ts \
  src/stores/chatStore.hydration.test.ts
```

### Phase 1 — 타입과 순수 정책

- [ ] SelectionContext/Proposal/Memory/Snapshot 타입
- [ ] ChatToolProfile
- [ ] pure `resolveChatToolNames()` 구현
- [ ] 도구 profile matrix 테스트
- [ ] 기존 sendMessage adapter 설계

이 단계에서는 UI/DB를 바꾸지 않는다.

### Phase 2 — Project Memory와 Forbidden Terms persistence

- [ ] SQLite schema
- [ ] Rust DTO/commands
- [ ] TypeScript invoke wrapper
- [ ] projectMemoryStore
- [ ] legacy projectContext migration
- [ ] project switch stale hydrate guard
- [ ] duplicate/hash 처리
- [ ] 프로젝트 복제 시 memory/금칙어 복사
- [ ] 프로젝트 삭제 시 cascade 확인

Rust 변경 후 `sync-types` 지침에 따라 타입 정합성을 검증한다.

### Phase 3 — translationUnitId와 selection anchor

- [ ] TranslationUnitId extension
- [ ] 기존 Source/Target 문서에 ID 보장
- [ ] 전체 번역/폴리싱 post-process ID 재부착
- [ ] SelectionAnchor extension
- [ ] transaction mapping/stale
- [ ] same-textblock 제한
- [ ] project switch/replace clear

이 단계 완료 시 AI 없이 위치 추적 단위 테스트가 통과해야 한다.

### Phase 4 — selection chip과 scope

- [ ] raw append 대신 selection card
- [ ] ChatMessage selection metadata
- [ ] selectionScopeId
- [ ] 동일 scope history 필터
- [ ] Source/Target chip 표시
- [ ] stale/detached UI
- [ ] Source에 retranslate 메뉴가 없는 테스트

### Phase 5 — Tool Registry와 선택 채팅

- [ ] registry/descriptor
- [ ] profile별 tool binding
- [ ] profile별 prompt
- [ ] get_selection_surroundings
- [ ] get_aligned_selection_context
- [ ] get_project_guidance
- [ ] search_project_glossary
- [ ] existing document tool schema/prompt 정합
- [ ] MCP allowlist/effect 분류
- [ ] TOOL_NAME_MAP 제거 또는 registry 파생
- [ ] ContextManifest 기록

### Phase 6 — 직접 선택 재번역

- [ ] Target 전용 메뉴
- [ ] 네 checkbox + 추가 지시문
- [ ] `retranslateSelection.ts`
- [ ] tools=0 dry-run
- [ ] selection preview
- [ ] stale/project guard
- [ ] apply transaction/Undo
- [ ] forbidden terms local validation

### Phase 7 — 채팅 수정안 적용

- [ ] propose_selection_edit
- [ ] assistant metadata
- [ ] proposal card
- [ ] preview/apply 공통 pipeline
- [ ] prose 자동 파싱 금지
- [ ] stale anchor 적용 차단
- [ ] duplicate text 정확 위치 테스트

### Phase 8 — 동적 메모리 제안

- [ ] propose_project_memory_change
- [ ] suggest_forbidden_term
- [ ] suggest_glossary_entry
- [ ] proposal cards
- [ ] approve/add/replace/archive
- [ ] Settings 관리 UI
- [ ] provenance 표시
- [ ] context revision 증가

### Phase 9 — 전체 workflow snapshot 통합

- [ ] full translate ContextSnapshot
- [ ] review 시작 시 snapshot 고정
- [ ] 모든 review chunk 동일 snapshot
- [ ] polish snapshot
- [ ] selection retranslate checkbox snapshot
- [ ] 새 chat에서 active project memory 확인
- [ ] metadata/context manifest

### Phase 10 — 회귀/E2E/문서

- [ ] unit/integration/typecheck/Rust tests
- [ ] web E2E
- [ ] Tauri E2E 시나리오
- [ ] test-ai dry-run
- [ ] `.claude/patterns.md`, `.claude/gotchas.md`, `.claude/CLAUDE.md` 최신화
- [ ] Desktop MCP 계약 변경 시 별도 배포 체크리스트

## 18. 테스트 계획

### 18.1 SelectionAnchor

- 앞에서 입력하면 anchor가 이동한다.
- 뒤에서 입력하면 anchor가 유지된다.
- 선택 범위 밖 수정은 active 유지한다.
- 선택 범위 내부 수정은 stale다.
- 선택 범위 삭제는 stale/detached다.
- 문서 전체 replace는 anchor를 clear한다.
- 동일 문구가 여러 번 있어도 anchor가 원래 위치를 유지한다.

### 18.2 translationUnitId

- Source 신규 paragraph에 ID가 생긴다.
- JSON/HTML round-trip에서 ID가 유지된다.
- 전체 번역 topology가 같으면 Target에 ID가 붙는다.
- 폴리싱 결과에 Target ID가 유지된다.
- topology 불일치는 unaligned 처리된다.
- split/join 후 잘못된 Source mapping을 만들지 않는다.

### 18.3 Tool Profile

- general에는 조건에 맞는 문서 도구가 있다.
- selection-source에는 propose_selection_edit가 없다.
- selection-target에는 aligned context/proposal이 있다.
- selection-retranslate에는 도구가 0개다.
- review 결과가 없으면 get_review_results가 없다.
- selection chat에 Confluence write 도구가 없다.
- prompt가 실제로 바인딩되지 않은 도구명을 언급하지 않는다.
- registry의 모든 tool은 UI display name과 trust/effect를 가진다.

### 18.4 Context payload

- selection 질문에 전체 Source/Target이 없다.
- 체크하지 않은 규칙/금칙어/용어집/Project Memory가 없다.
- 같은 selection scope 대화만 포함된다.
- 새 selection scope에서 이전 scope summary가 주입되지 않는다.
- direct retranslate input 크기가 전체 문서 길이가 아니라 선택문 길이에 비례한다.
- 5,000단어 문서에서도 selection 초기 페이로드가 일정 범위 안이다.

### 18.5 proposal/apply

- Target proposal은 문서를 즉시 변경하지 않는다.
- 미리보기 승인 후 정확한 range만 바뀐다.
- Source selection에는 apply UI가 없다.
- 다른 문단을 편집한 뒤에도 원래 Target selection에 적용된다.
- selection 내부를 편집하면 적용이 막힌다.
- project 전환 후 늦게 온 응답은 적용되지 않는다.
- 앱 재실행 후 proposal은 detached다.
- Undo 1회로 원복된다.
- mark preservation 정책이 지켜진다.

### 18.6 Project Memory

- 제안만으로 active memory가 바뀌지 않는다.
- 승인 후 새 채팅에서 보인다.
- replace는 기존 항목 archive + supersedes 연결이다.
- exact duplicate는 중복 저장하지 않는다.
- 프로젝트 전환 시 메모리가 섞이지 않는다.
- legacy projectContext가 손실 없이 migration된다.
- 현재 프로젝트 clone/delete cascade가 올바르다.

### 18.7 ContextSnapshot

- 실행 중 memory가 바뀌어도 현재 translation snapshot은 동일하다.
- review 모든 chunk가 같은 revision을 사용한다.
- 다음 실행은 최신 revision을 사용한다.
- context manifest item IDs와 실제 resolver 결과가 일치한다.

### 18.8 E2E 핵심 시나리오

```text
프로젝트 생성
→ 5,000단어 이하 Source 입력
→ 전체 번역
→ 전체 폴리싱
→ Target 문장 선택
→ 의미 질문
→ aligned Source 도구 사용 확인
→ 수정안 proposal
→ 미리보기
→ 원위치 적용
→ Undo
→ 다른 문장 직접 재번역
→ Project Context만 체크
→ 적용
→ 채팅에서 새 audience 정보 제안
→ 프로젝트 메모리에 승인
→ 새 채팅 생성
→ 새 메모리 확인
→ 검수 실행
→ 동일 ContextSnapshot revision 확인
```

## 19. 검증 명령

구현 단계별:

```bash
npx tsc --noEmit
npm run test:run
```

Rust/DB 변경 후:

```bash
cd src-tauri && cargo test
```

웹 E2E:

```bash
npm run test:e2e:web
```

최종 로컬 CI:

```bash
npm run test:ci:local
```

Tauri 전체 gate가 필요한 릴리스 전:

```bash
npm run test:tauri
```

AI dry-run에서 출력해야 할 항목:

```text
mode
tool profile
bound tool names
tool schema estimated tokens
selection chars
aligned source chars
included memory item IDs
included forbidden term IDs
included glossary entry IDs
whole source/target included 여부
estimated total input tokens
```

실제 API 테스트는 dry-run과 mock 테스트가 통과한 뒤 최소 케이스로 실행한다.

## 20. 완료 조건

### 기능

- [ ] Source 선택에는 질문만 있고 재번역이 없다.
- [ ] Target 선택에서 질문/직접 재번역이 가능하다.
- [ ] 선택문이 raw composer text가 아니라 selection metadata로 유지된다.
- [ ] AI 수정안을 복사·붙여넣기 없이 적용할 수 있다.
- [ ] 미리보기 없이 문서가 바뀌지 않는다.
- [ ] 문서 다른 위치를 편집해도 원래 선택 위치가 유지된다.
- [ ] 선택 영역 자체가 바뀌면 적용이 차단된다.

### 컨텍스트/토큰

- [ ] selection chat 기본 payload에 전체 문서가 없다.
- [ ] direct selection retranslate의 bound tools가 0개다.
- [ ] 체크하지 않은 컨텍스트가 포함되지 않는다.
- [ ] 새 selection scope가 과거 scope 대화로 오염되지 않는다.
- [ ] 실제 사용 컨텍스트가 ContextManifest로 보인다.

### 동적 메모리

- [ ] 채팅에서 규칙/금칙어/용어/Project Memory를 분류해 제안할 수 있다.
- [ ] 사용자 승인 전에는 영구 반영되지 않는다.
- [ ] 승인된 Project Memory가 새 채팅에 유지된다.
- [ ] 전체 번역/검수/폴리싱이 최신 승인 메모리를 사용한다.
- [ ] 실행 중에는 snapshot이 바뀌지 않는다.
- [ ] 중복/충돌/출처/보관 상태를 확인할 수 있다.

### 품질

- [ ] TypeScript typecheck 통과
- [ ] unit/integration tests 통과
- [ ] Rust tests 통과
- [ ] 핵심 E2E 통과
- [ ] 기존 전체 번역/검수/폴리싱 회귀 없음
- [ ] 구현 시작 시 존재한 사용자 변경 보존

## 21. 위험과 대응

| 위험 | 대응 |
|---|---|
| anchor가 잘못된 위치를 가리킴 | DecorationSet mapping + text 검증 + stale 차단 |
| 번역 결과 topology가 달라 Source mapping 실패 | post-process validation, 실패 시 재번역 비활성 |
| 동적 memory가 잘못된 사실을 영구화 | proposal-only + 사용자 승인 |
| memory가 계속 커져 토큰 증가 | structured resolver, workflow별 필터, item cap |
| review 청크마다 기준이 달라짐 | 시작 시 ContextSnapshot 고정 |
| 외부 MCP 도구가 예고 없이 추가됨 | registry allowlist/effect gate |
| AI prose를 잘못 파싱해 문서 손상 | proposal tool만 적용 가능 |
| 앱 재실행 후 오래된 proposal 적용 | runtime anchor 비영속, detached 표시 |
| legacy projectContext 손실 | adapter + idempotent migration |
| 기존 selection copy 메뉴와 충돌 | 기준 커밋과 작업 시작 전 diff 확인, 관련 line 최소 수정 |

## 22. 구현 세션용 시작 프롬프트

새 세션에는 다음과 같이 전달한다.

```text
`docs/selection-editing-and-dynamic-context-plan.md`를 구현 기준으로 읽고,
Phase 0부터 순서대로 진행해줘.

반드시 `.claude/CLAUDE.md`와 연결된 규칙을 먼저 읽고,
현재 작업 트리의 미커밋 변경은 사용자 작업이므로 덮어쓰거나 되돌리지 마.

한 번에 전체 기능을 크게 구현하지 말고 각 Phase를 테스트 가능한 작은 변경으로 나눠.
특히 다음 불변식을 지켜:
- Source 선택에는 재번역/적용 없음
- direct selection retranslate bound tools = 0
- AI document write는 proposal + preview + 사용자 승인만
- selection anchor stale/project revision 검증
- Project Memory는 사용자 승인 후 active
- review run은 단일 ContextSnapshot 사용

각 Phase 완료 시 관련 unit test와 `npx tsc --noEmit`을 실행하고,
Rust 변경 시 `cargo test`도 실행해.
```

## 23. 구현자가 먼저 확인할 핵심 파일

```text
.claude/CLAUDE.md
.claude/patterns.md
.claude/gotchas.md

src/components/editor/EditorCanvasTipTap.tsx
src/components/ui/SelectionActionMenu.tsx
src/components/chat/ChatContent.tsx
src/components/chat/ChatMessageItem.tsx

src/stores/chatStore.ai.ts
src/stores/chatStore.types.ts
src/stores/chatStore.persist.ts
src/stores/chatStore.session.ts
src/stores/chatStore.settings.ts

src/ai/chat.ts
src/ai/prompt.ts
src/ai/tools/documentTools.ts
src/ai/tools/suggestionTools.ts
src/ai/chatContext/conversationContext.ts

src/ai/translateDocument.ts
src/ai/polishDocument.ts
src/ai/review/runReview.ts
src/components/review/ReviewPanel.tsx

src/types/index.ts
src/tauri/chat.ts
src-tauri/src/commands/chat.rs
src-tauri/src/db/schema.rs
src-tauri/src/db/mod.rs
```

---

이 계획의 최종 성공 기준은 “전체 문서 작업”과 “선택 영역 수정”을 별도 기능으로 병렬 배치하는 것이 아니다. 번역가가 전체 번역으로 초안을 만들고, 선택 채팅과 부분 재번역으로 문장을 정교하게 고치며, 그 과정에서 확정된 프로젝트 지식이 다음 작업의 품질을 높이는 하나의 연속된 편집 시스템을 만드는 것이다.
