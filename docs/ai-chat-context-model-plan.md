# AI Chat 장기 대화·세션 모델 개선 구현 계획

> 작성: 2026-07-23  
> 상태: **Phase 0/1/2/3/4 구현 완료** (2026-07-23 업데이트). 연기 항목: delete-all→증분 upsert 성능 최적화(YAGNI), 실 AI 장기대화 Chat E2E(`test:tauri` 게이트).  
> 목적: 이 문서만 읽고 새 세션에서 TDD 구현을 이어갈 수 있도록 현재 문제, 확정 결정, 단계별 작업, 마이그레이션과 완료 조건을 정리한다.
>
> **진행 상황 요약은 [§16 Phase 3](#16-phase-3-구현-진행-2026-07-23) / [§17 Phase 4](#17-phase-4-구현-진행-2026-07-23) 참조.** 핵심 4단계 구현 완료.

## 1. 목표

현재 AI Chat은 LangChain의 모델·메시지·도구 API를 사용하지만, 대화 메모리와 도구 루프는 앱에서 직접 관리한다. 이 구조에서 다음 문제를 해결한다.

1. 최근 20개 메시지 절단으로 약 10턴 이후 맥락이 사라지는 문제
2. 메시지 개수 중심 제한으로 긴 첨부·도구 결과의 토큰 사용량을 반영하지 못하는 문제
3. 실제 요약 없이 새 세션만 권유하는 장기 대화 UX
4. 전역 모델 설정이 모든 채팅 세션에 공유되는 문제
5. 요청 준비 중 모델을 바꾸면 기록 모델과 실제 호출 모델이 달라질 수 있는 경쟁 조건
6. 모델 변경 시 context window, vision, tool calling 등 capability 차이를 반영하지 않는 문제
7. 프런트 1,000개 / SQLite 100개 / 모델 입력 20개의 상충하는 메시지 보존 정책

최종적으로 사용자는 한 채팅을 길게 이어갈 수 있고, 세션마다 기본 모델을 선택하며, 응답이 진행 중이지 않을 때 다음 응답부터 모델을 변경할 수 있어야 한다.

## 2. 확정 설계 결정

| 항목 | 결정 |
|---|---|
| 대화 중 모델 변경 | 영구 잠금하지 않는다. **턴 경계에서만 변경 허용**하고 진행 중 요청에서는 앱 전체 모델 관련 설정을 잠근다. |
| 모델 설정 범위 | `chatModel` 전역값은 **새 세션 기본값**으로만 사용하고, 실제 선택은 `ChatSession.modelPreset`에 저장한다. |
| 실행 설정 | 전송 시 `ModelRunConfig`를 한 번 캡처하고, 해당 요청의 프롬프트·모델·메타데이터·도구 루프가 동일 객체를 사용한다. |
| 장기 대화 | 전체 transcript와 모델 working context를 분리한다. 전체 메시지는 보존하고, 모델에는 `누적 요약 + 최근 원문 대화`를 전달한다. |
| 절단 기준 | 고정 메시지 수가 아니라 대상 모델의 **입력 토큰 예산**을 사용한다. `trimMessages`는 최종 안전장치로 둔다. |
| 요약 | 오래된 메시지를 증분 요약한다. 최근 8~12턴은 원문으로 유지한다. |
| 요약 모델 | 세션 채팅 모델과 분리 가능한 저비용 모델을 사용한다. 사용자가 채팅 모델을 바꿔도 요약 모델은 자동으로 따라 바뀌지 않는다. |
| 모델 변경 경계 | 기존 대화에서 모델을 바꾸면 UI에 경계를 표시하고, 새 모델 기준으로 컨텍스트 예산과 capability를 재검증한다. |
| LangGraph 전환 | 1차 구현에서는 강제하지 않는다. 현재 Tauri/SQLite 구조에 안전한 context manager를 만든 뒤 필요 시 `createAgent`/checkpointer로 옮긴다. |
| 저장 정책 | UI에서 보이는 transcript를 토큰 절약 목적으로 파괴하지 않는다. SQLite 보존 한도는 프런트 정책과 정렬한다. |

## 3. 현재 구현 진단

### 3.1 LangChain 사용 형태

- 패키지: `langchain`, `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`
- 모델 생성: `src/ai/client.ts`
- 프롬프트 조립: `src/ai/prompt.ts`
- 직접 구현한 도구 호출 루프: `src/ai/chat.ts::runToolCallingLoop`
- 상태·영속성: `src/stores/chatStore.*`, Rust SQLite `src-tauri/src/db/mod.rs`

즉 LangChain의 표준 모델 및 도구 타입은 사용하지만 `createAgent`, checkpointer, summarization/context-editing middleware 기반 에이전트 상태는 사용하지 않는다.

### 3.2 장기 대화 제약

| 문제 | 현재 위치 | 영향 |
|---|---|---|
| `maxRecentMessages: 20` 고정 | `src/ai/config.ts:154` | 약 10턴 이후 초기 대화가 모델 입력에서 사라짐 |
| 최근 메시지 단순 `slice` | `src/stores/chatStore.ai.ts:440-443` | 토큰 길이·턴 경계·중요도 미반영 |
| history를 그대로 메시지 변환 | `src/ai/prompt.ts:288-323, 369` | 오래된 이미지 일부만 제거할 뿐 요약 없음 |
| “대화가 길어짐” 기준 30개 | `src/stores/chatStore.types.ts:9`, `chatStore.selectors.ts:104-109` | 이미 맥락을 잃은 뒤에야 알림 표시 |
| 알림 동작은 새 세션 생성 | `src/stores/chatStore.session.ts:314-337` | 실제 요약·연속성 없음 |
| 도구 루프 80 메시지 제한 | `src/ai/chat.ts:322-324, 567-579` | 메시지 크기와 모델별 context window 미반영 |
| 토큰 사용량 미수집 | `src/types/index.ts:179-182`에 필드만 존재 | 비용·context 사용률·요약 트리거 관측 불가 |

### 3.3 모델 변경 경쟁 조건

1. 채팅 패널마다 선택기가 있지만 값은 전역 `aiConfigStore.chatModel`이다.
   - `src/components/chat/ChatContent.tsx:137-173, 677-689`
   - `src/stores/aiConfigStore.ts:17-21, 312-313`
2. `executeAiReply`가 요청 초기에 `getAiConfig()`를 호출해 assistant 메타데이터를 만든다.
   - `src/stores/chatStore.ai.ts:161-162, 214-219`
3. 글로서리 조회 등 비동기 준비 뒤 `streamAssistantReply`가 다시 `getAiConfig()`를 호출해 실제 모델을 만든다.
   - `src/stores/chatStore.ai.ts:183-210, 294-319`
   - `src/ai/chat.ts:889-905`
4. 첫 조회와 두 번째 조회 사이에 모델이 바뀌면 기록 모델과 실제 모델이 달라질 수 있다.
5. 모델 선택기는 세션별 `isLoading`만 보지만, 준비 단계에는 `streamingSessionId`가 아직 없을 수 있다.
   - `src/stores/chatStore.selectors.ts:137-146`
   - `src/components/chat/ChatContent.tsx:682`
6. 다른 채팅 패널의 선택기는 활성 상태로 남을 수 있고, Provider 설정 변경도 진행 중 요청을 확인하지 않는다.
   - `src/stores/aiConfigStore.ts:353-393`

### 3.4 저장 정책 불일치

| 계층 | 한도 | 위치 |
|---|---:|---|
| 프런트 세션 | 1,000 메시지 | `src/stores/chatStore.types.ts:8` |
| SQLite | 최근 100 메시지 | `src-tauri/src/db/mod.rs:887, 903-910` |
| 모델 입력 | 최근 20 메시지 | `src/ai/config.ts:154` |

`save_chat_sessions`는 기존 세션/메시지를 삭제한 뒤 최근 메시지만 다시 삽입한다(`src-tauri/src/db/mod.rs:858-866`). 앱 재시작 후에는 오래된 transcript를 요약 재생성이나 감사에 사용할 수 없다.

## 4. 목표 아키텍처

```text
Chat UI
  ├─ ChatSession.modelPreset
  ├─ 전체 transcript
  └─ 요약/모델 변경 상태
          │
          ▼
captureModelRunConfig(session)
  ├─ provider / requestedPreset / resolvedModel
  ├─ reasoningEffort / output budget
  └─ capability profile
          │
          ▼
ConversationContextManager
  ├─ system + project context
  ├─ accumulated summary
  ├─ recent raw turns
  ├─ attachment/tool-result budget
  └─ trimMessages hard guard
          │
          ▼
streamAssistantReply(input, runConfig)
          │
          ▼
tool loop
  ├─ run-level model/tool call limits
  ├─ token-aware context editing
  └─ same immutable runConfig
          │
          ▼
message metadata + usage persistence
```

핵심 경계는 다음과 같다.

- `aiConfigStore`: 새 세션 기본 설정 및 API key/Provider availability
- `ChatSession`: 세션별 선택과 장기 대화 상태
- `ModelRunConfig`: 단일 요청의 불변 실행 설정
- `ConversationContextManager`: 모델에 보낼 working context
- SQLite: 전체 transcript와 세션 상태의 영구 저장소

## 5. 데이터 모델

### 5.1 TypeScript

`ChatSession`에 다음 필드를 추가한다.

```ts
interface ChatSession {
  // existing
  id: string;
  name: string;
  createdAt: number;
  messages: ChatMessage[];
  contextBlockIds: string[];
  confluenceSearchEnabled?: boolean;

  // new
  modelPreset: string;
  memory?: ChatSessionMemory;
}

interface ChatSessionMemory {
  summary: string;
  summarizedThroughMessageId: string | null;
  summaryUpdatedAt: number | null;
  summaryModel: string | null;
  summaryVersion: number;
}
```

`ChatMessageMetadata`에는 다음 실행 출처를 추가한다.

```ts
interface ChatMessageMetadata {
  requestedModelPreset?: string;
  resolvedModel?: string;
  provider?: 'openai' | 'anthropic';
  reasoningEffort?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextUtilization?: number;
}
```

기존 `metadata.model`은 마이그레이션 호환을 위해 읽기는 지원하되 새 쓰기에서는 위 필드로 대체한다.

### 5.2 불변 실행 설정

```ts
interface ModelRunConfig {
  requestedPreset: string;
  resolvedModel: string;
  provider: 'openai' | 'anthropic';
  reasoningEffort?: string;
  outputTokenBudget: number;
  maxInputTokens: number;
  capabilities: {
    toolCalling: boolean;
    imageInputs: boolean;
    reasoningOutput: boolean;
    builtInWebSearch: boolean;
  };
}
```

규칙:

1. `sendMessage`/`replayMessage`가 시작될 때 한 번 생성한다.
2. `executeAiReply`, `streamAssistantReply`, `createChatModel`, context manager에 명시적으로 전달한다.
3. 해당 호출이 끝날 때까지 전역 store를 다시 읽어 모델을 결정하지 않는다.
4. 메시지 메타데이터는 이 객체에서 만든다.

### 5.3 Rust/SQLite

`chat_sessions`에 다음 컬럼을 추가하는 방향을 우선 검토한다.

```sql
model_preset TEXT NOT NULL
memory_json TEXT
```

- `memory_json`은 `ChatSessionMemory`의 versioned JSON이다.
- 기존 DB migration 시 `model_preset` 기본값은 앱의 안전한 기본 모델로 채운다.
- 프런트의 persisted `aiConfigStore.chatModel`은 마이그레이션 직후 새 세션 기본값으로만 사용한다.
- SQLite의 100개 메시지 clamp는 최소한 프런트의 1,000개 정책과 맞춘다.
- 저장 성능이 문제되면 이후 delete-all/reinsert를 증분 upsert로 분리하되, 장기 대화 개선의 필수 선행 조건은 아니다.

## 6. 모델 capability와 전환 정책

### 6.1 모델 프로필

가능하면 LangChain `model.profile`의 다음 값을 사용한다.

- `maxInputTokens`
- `imageInputs`
- `toolCalling`
- `reasoningOutput`
- structured output 관련 capability

프로젝트가 사용하는 alias/preset에 profile이 없거나 부정확할 수 있으므로, 앱의 `MODEL_PRESETS`에도 최소 capability fallback을 둔다. profile과 fallback이 충돌하면 보수적인 값을 선택하고 로그를 남긴다.

### 6.2 UI 정책

| 상태 | 동작 |
|---|---|
| 빈 세션 | 즉시 모델 변경 |
| 메시지가 있는 idle 세션 | 변경 허용, “다음 응답부터 적용” |
| 준비·스트리밍·도구 실행 중 | 모든 채팅 모델 선택기와 Provider 변경 잠금 |
| 더 작은 context 모델 | 다음 호출 전 자동 재요약/트리밍 |
| vision 미지원 모델 | 최근 working context에 이미지가 있으면 경고 또는 이미지 제외 확인 |
| tool calling 미지원 모델 | 현재 Chat 도구 파이프라인에서는 선택 불가 |
| Provider 비활성화 | 세션 모델을 조용히 교체하지 않고 unavailable 상태와 재선택 CTA 표시 |

### 6.3 모델 변경 기록

모델 변경은 LLM 대화 메시지로 삽입하지 않는다. 별도 session event 또는 UI-only boundary로 저장한다.

```ts
interface ChatModelChangeEvent {
  id: string;
  timestamp: number;
  fromPreset: string;
  toPreset: string;
}
```

1차 구현에서 별도 event 테이블이 과하면 assistant/user 메시지와 분리된 `session.events` JSON으로 시작할 수 있다. 어떤 방식을 선택하든 모델에 일반 대화 메시지로 전달하지 않는다.

## 7. 장기 대화 Context Manager

### 7.1 입력 구성

모델별 입력 예산은 다음처럼 계산한다.

```text
usableInputBudget
  = maxInputTokens
  - outputTokenBudget
  - reasoning/tool safety reserve
```

working context의 우선순위:

1. 시스템 프롬프트 및 안전 지침
2. 번역 규칙, 프로젝트 컨텍스트, 주입 글로서리
3. 누적 대화 요약
4. 최근 원문 대화
5. 현재 요청의 첨부와 이미지
6. 현재 도구 호출의 AI/Tool 쌍

고정 컨텍스트가 예산을 과도하게 차지하면 조용히 자르지 않고 어느 영역이 축약됐는지 내부 telemetry에 기록한다.

### 7.2 요약 트리거

초기값:

- 사전 요약 trigger: usable input budget의 70~80%
- 보존: 최근 8~12턴
- `trimMessages`: 모델 호출 직전 하드 제한
- 이미지: 최근 원문 메시지 중 capability/예산을 만족하는 범위만 유지

정확한 비율은 테스트 fixture로 튜닝하며 코드 상수로 중앙화한다.

### 7.3 증분 요약

요약 입력:

```text
기존 누적 요약
+ 아직 요약되지 않은 오래된 메시지 구간
```

요약 결과에 반드시 포함할 항목:

- 사용자의 현재 목표
- 확정한 번역/용어/표현과 이유
- 거부한 대안
- 문체·톤·형식 선호
- 중요한 문서 및 도구 근거
- 미해결 질문
- 다음 작업

요약은 외부 문서 지시를 실행하지 않도록 기존 `<untrusted>` 신뢰 경계 원칙을 유지한다. 요약 생성에 실패하면 기존 요약과 더 적은 최근 대화로 안전하게 fallback하되, 기존 transcript를 삭제하지 않는다.

### 7.4 도구 결과 context editing

- 현재 turn의 AI tool call과 ToolMessage는 항상 쌍으로 유지한다.
- 최근 2~3개 도구 결과는 원문 보존을 기본값으로 한다.
- 오래된 대형 도구 결과는 `[cleared: tool_name, reference, short digest]` 형태로 교체한다.
- 문서 도구는 기존 `maxChars/query/aroundChars` 제한을 계속 사용한다.
- `MAX_LOOP_MESSAGES`는 즉시 삭제하지 말고 token-aware guard가 안정화될 때까지 비상 상한으로 유지한 뒤 제거 여부를 결정한다.
- run-level model call/tool call 제한은 context 크기 제한과 별도로 둔다.

## 8. 구현 단계

### Phase 0 — 기준선과 LangChain 호환성

- [x] 현재 관련 테스트 실행 및 기준선 기록 (config/client/aiConfig/integration 48 tests green)
- [~] LangChain 계열 패키지를 동일 호환 범위의 최신 1.x로 업데이트 — 이미 1.x (`langchain@1.2.3`, `@langchain/core@1.1.8`, anthropic 1.3.10, openai 1.2.0). 별도 bump는 하지 않음(현행 유지)
- [x] `usage_metadata` API 확인(runToolCallingLoop `finalAiMessage.usage_metadata`로 집계). `trimMessages`/model profile은 Phase 3에서 사용
- [x] TypeScript typecheck 및 전체 unit test
- [ ] 별도 commit으로 격리 (사용자 커밋 권한 대기 중 — 아직 커밋 안 함)

완료 조건:

- 기존 Chat/Translation/Review 동작에 회귀 없음
- 기존 provider model option guard 테스트 통과

### Phase 1 — 모델 실행 경쟁 조건 제거

대상:

- `src/ai/config.ts`
- `src/ai/client.ts`
- `src/ai/chat.ts`
- `src/stores/chatStore.ai.ts`
- `src/types/index.ts`

TDD:

- [x] 요청 준비 중 전역 모델이 바뀌어도 실제 호출 모델이 변하지 않음 (`modelRunConfig.test.ts`)
- [x] 메시지 메타데이터와 실제 호출 설정이 일치 (`chatStore.integration.test.ts` "assistant 메시지 메타데이터가 캡처된 runConfig…")
- [x] replay도 동일 capture 정책 사용 (executeAiReply 공용 → replay도 runConfig 캡처)
- [x] `/web` 경로도 run config를 한 번만 capture (webRunConfig)

구현:

- [x] `resolveModelRunConfig(options)` 추가 (`src/ai/config.ts`, `preset` 오버라이드 + `Object.freeze`)
- [x] `createChatModel`에 `options.runConfig` 추가 — runConfig 있으면 전역 store 재조회 없음(번역/검수/폴리싱은 기존 경로 그대로, 하위호환)
- [x] `streamAssistantReply(input, runConfig, cb?)` — runConfig 필수 인자
- [x] Chat 하위 경로에서 모델 결정을 위한 `getAiConfig()` 재호출 제거 (chat.ts는 getAiConfig 미사용. sendMessage/replay의 `getAiConfig().maxRecentMessages`는 모델 결정과 무관해 유지 → Phase 3에서 제거)
- [x] 실제 usage metadata 수집 및 assistant metadata 반영 (`onUsage` → inputTokens/outputTokens/totalTokens)

### Phase 2 — 세션별 모델과 UI 잠금

대상:

- `src/types/index.ts`
- `src/stores/chatStore.types.ts`
- `src/stores/chatStore.session.ts`
- `src/components/chat/ChatContent.tsx`
- `src/components/chat/ChatMessageItem.tsx`
- `src/stores/aiConfigStore.ts`
- Rust chat models/schema/db
- i18n 양쪽 locale

TDD:

- [x] 세션 A 모델 변경이 세션 B에 영향 없음 (`chatStore.sessionModel.test.ts`)
- [x] 새 세션은 전역 기본 모델을 상속 (동 테스트)
- [x] 기존 세션 hydrate migration (Rust `chat_session_model_preset_roundtrip_and_legacy_null` + TS hydrate 백필)
- [x] global `isLoading` 동안 모든 모델 선택기 disabled (`disabled={globalIsLoading}`)
- [x] Provider disable이 기존 세션 모델을 조용히 바꾸지 않음 (세션 모델은 chatStore, provider disable은 전역 chatModel만 조정)
- [x] 모델 배지 렌더 (`ChatMessageItem` `chat-message-model-badge`) / 변경 경계는 "다음 응답부터 적용" 힌트로 최소 구현
- [~] 모델 변경 경계(ChatModelChangeEvent 구조체) — 별도 이벤트 저장은 미구현. 현재는 메시지 metadata의 requestedModelPreset 차이로 UI 힌트만 표시. §6.3 이벤트 저장은 Phase 3+에서 필요 시 추가

구현:

- [x] `ChatSession.modelPreset?: string` (optional — 마이그레이션 안전; undefined면 전역 기본 상속)
- [x] 세션별 setter `setSessionModelPreset(sessionId, preset)`
- [x] 전역 `chatModel` 의미를 "새 세션 기본값"으로 명확화 (주석 + createSession/hydrate에서만 상속에 사용)
- [x] assistant message model badge (resolvedModel ?? 레거시 model)
- [x] "다음 응답부터 적용" UX (idle 세션에서 마지막 assistant의 requestedModelPreset ≠ 현재 세션 preset일 때 힌트)
- [~] capability mismatch 안내 — provider 비활성 세션 모델을 조용히 바꾸지 않고 "현재" 그룹으로 노출까지만. context/vision/tool capability 심화 검증은 Phase 3(modelCapabilities)

### Phase 3 — 장기 대화 요약과 토큰 예산

신규 후보:

- `src/ai/chatContext/modelCapabilities.ts`
- `src/ai/chatContext/tokenBudget.ts`
- `src/ai/chatContext/conversationContext.ts`
- `src/ai/chatContext/summarizeConversation.ts`

수정 대상:

- `src/ai/prompt.ts`
- `src/ai/chat.ts`
- `src/stores/chatStore.ai.ts`
- `src/stores/chatStore.session.ts`
- Rust chat session persistence

TDD:

- [x] 100개 이상 짧은 메시지에서 초기 결정이 summary로 유지 (`conversationContext.test.ts` + `chatStore.integration.test.ts`)
- [x] 한 개의 매우 긴 메시지가 있는 경우 token budget 적용 (`conversationContext.test.ts`)
- [x] 기존 summary에 새 구간만 증분 반영 (`conversationContext.test.ts` 증분 + `summarizeConversation.test.ts`)
- [x] 요약 실패 시 transcript 무손실 fallback (`summarizeConversation.test.ts` + store 통합 fallback 케이스)
- [x] smaller-context 모델 전환 시 자동 재예산 (`conversationContext.test.ts` "작은 예산일수록 윈도우 축소")
- [x] 시스템 메시지 보존 (`prompt.test.ts` system 맨 앞 + chat.ts `trimMessages` includeSystem)
- [x] history가 user부터 시작하도록 유효성 유지 (`conversationContext.test.ts` user-start)
- [~] AI tool call/ToolMessage 쌍 보존 — 영속 transcript엔 ToolMessage가 없어 planner/trimMessages가 쌍을 깨지 않음. 도구 루프 내부는 `MAX_LOOP_MESSAGES`로 Phase 4까지 유지
- [x] 이미지 capability 및 history 제한 (`prompt.test.ts` imageInputs=false strip + `MAX_HISTORY_IMAGES_MESSAGES`)

구현:

- [x] `maxRecentMessages: 20` 경로 제거 (store의 `slice(-20)` 제거·전체 prior 전달. config 필드는 `@deprecated`로 유지)
- [x] summary + recent turns 조립 (`conversationContext.ts` → `prompt.ts` `[이전 대화 요약]` 블록 + recent 원문)
- [x] target model token budget (`modelCapabilities.ts` + `tokenBudget.ts`)
- [x] `trimMessages` hard guard (`chat.ts::applyInputTokenGuard`)
- [x] summary persistence (Rust `memory_json` 컬럼 + `updateSessionMemory` 액션)
- [x] 실제 summary notice UI (`ChatContent` 요약 활성 알림 + i18n)

### Phase 4 — 도구 context editing과 저장 정책 정리

- [x] 오래된 tool result 축약 (`chat.ts::compressOldToolMessages`, `[cleared: name | N chars | "…"]`; 쌍 보존)
- [x] tool/model call limit 중앙화 (`DEFAULT_MAX_MODEL_STEPS`/`MAX_MODEL_STEPS_CAP`/`MAX_LOOP_MESSAGES`/`MAX_SAME_ERROR` 그룹화·주석)
- [x] SQLite 최근 100개 destructive clamp → 1,000개로 정렬 (`db/mod.rs` `MAX_MESSAGES_PER_SESSION` 100→1000, 프런트와 정렬)
- [~] delete-all/reinsert 성능 측정 — 현 규모(디바운스 800ms·로컬 SQLite·≤5세션×≤1000)에서 병목 아님. 증분 upsert는 연기(YAGNI)
- [~] 필요 시 증분 upsert 후속 구현 — 위 판단으로 연기
- [x] 장기 대화 telemetry (`ChatMessageMetadata.contextUtilization` = 실 입력토큰/컨텍스트윈도우, §12.5 실 usage 기반)
- [~] Chat E2E 추가 — 요약 트리거/영속/fallback/clamp는 unit+store 통합으로 커버. 실 AI가 필요한 장기대화 시나리오는 `test:tauri`(릴리스 게이트)로 남김

## 9. 테스트 매트릭스

| 영역 | 필수 케이스 |
|---|---|
| 모델 불변성 | preflight 중 전역 변경, 다른 탭 변경, Provider disable, replay |
| 세션 격리 | 두 세션 서로 다른 모델, hydrate/restart, 새 세션 default |
| 모델 전환 | same provider, cross provider, smaller context, capability mismatch |
| 대화 요약 | 30/100/1,000 메시지, 긴 단일 메시지, 기존 summary 증분 |
| 도구 | 병렬 tool calls, 대형 결과, 반복 실패, AI/Tool pair validity |
| 이미지 | 현재 turn 이미지, 역사 이미지, vision 미지원 전환 |
| 저장 | 기존 DB migration, restart 복원, summary version 호환 |
| 취소/경쟁 | abort, 프로젝트 전환, 늦은 stream resolve, 요약 중 취소 |
| 관측 | input/output/total tokens, 실제 모델, context utilization |

검증 명령:

```bash
npx tsc --noEmit
npm run test:run
cd src-tauri && cargo test
npm run test:e2e:web
```

최종 Tauri gate는 저장 마이그레이션과 UI까지 완료한 뒤 실행한다.

```bash
npm run test:tauri
```

## 10. 완료 기준

### 기능

- [ ] 한 세션에서 100개 이상 메시지를 주고받아도 초기 중요 결정이 요약으로 유지된다.
- [ ] UI의 전체 transcript는 모델 context 절약 때문에 사라지지 않는다.
- [ ] 각 세션이 독립적인 모델을 가진다.
- [ ] 응답 중 모델/Provider 설정을 바꿀 수 없다.
- [ ] 응답 메시지에 실제 모델 출처가 표시된다.
- [ ] idle 상태에서 모델을 바꾸면 다음 응답부터 적용된다.
- [ ] 작은 context 또는 capability가 다른 모델로 바꿀 때 안전한 안내/재요약이 동작한다.
- [ ] 앱 재시작 후 모델, summary, transcript가 복원된다.

### 품질

- [ ] 실제 모델과 기록된 모델이 달라지는 경로가 없다.
- [ ] 모델 입력이 예산을 초과하지 않는다.
- [ ] tool call protocol이 절단으로 깨지지 않는다.
- [ ] 요약 실패가 원본 transcript 손실로 이어지지 않는다.
- [ ] OpenAI와 Anthropic 양쪽에서 동일한 핵심 시나리오가 통과한다.

### 회귀

- [ ] 번역/검수/폴리싱 모델 선택은 기존 용도 분리를 유지한다.
- [ ] No Auto-Apply / Preview-First 원칙에 영향이 없다.
- [ ] 기존 chat edit/replay/delete/abort 동작이 유지된다.
- [ ] Confluence/Notion/Web Search 도구 gate가 유지된다.

## 11. 범위 밖

- 모든 AI 기능을 즉시 LangGraph `createAgent`로 이전
- 서버형 Postgres checkpointer 도입
- 세션 간 사용자 개인화 memory 자동 추출
- 프로젝트 규칙/글로서리에 대화 내용을 자동 반영
- 여러 채팅 요청의 동시 스트리밍

세션 간 장기 memory가 필요해지면 사용자 확인 기반으로 프로젝트 컨텍스트/글로서리에 승격하는 별도 기능으로 설계한다. 번역사 주도 원칙상 대화에서 추출한 내용을 자동 저장하지 않는다.

## 12. 구현 시 주의사항

1. `getAiConfig()`를 완전히 금지하는 것이 아니라 **요청 실행 도중 모델 결정을 위해 재호출하는 것**을 금지한다.
2. 요약은 UI transcript 대체물이 아니다. `summary`와 `messages`를 동시에 저장한다.
3. 모델 전환 event를 일반 Human/System message로 모델에 전달하지 않는다.
4. summary 생성도 AbortSignal과 프로젝트/세션 소유권 검증을 적용한다.
5. Provider별 토큰 수가 정확히 같지 않으므로 실제 usage와 사전 추정치를 분리 기록한다.
6. LangChain model profile은 beta이므로 fallback registry와 검증 테스트를 둔다.
7. 세션 모델이 unavailable이어도 hydrate 시 조용히 다른 모델로 바꾸지 않는다.
8. 모델 선택 UI는 세션 범위임을 명확히 보이게 하고, 앱 설정의 기본 모델과 구분한다.

## 13. 새 구현 세션 시작 체크리스트

1. `.claude/CLAUDE.md`와 `.claude/rules/ai-chain.md`를 읽는다.
2. 이 문서를 전체 읽고 Phase 0/1부터 시작한다.
3. 작업 시작 전 `git status --short`로 사용자 변경을 확인한다.
4. `/tdd` 규칙에 따라 실패 테스트를 먼저 작성한다.
5. 각 Phase는 독립 검증 가능한 단위로 유지한다.
6. Phase 1/2가 안정화되기 전 Phase 3 요약 구현을 섞지 않는다.
7. DB migration은 기존 프로젝트 파일 복사본으로 실제 복원 테스트한다.
8. 구현 완료 뒤 `.claude/architecture.md`, `.claude/patterns.md`, `.claude/gotchas.md`, `.claude/testing.md`를 실제 상태에 맞게 업데이트한다.

## 14. 공식 참고자료

- LangChain Short-term memory: https://docs.langchain.com/oss/javascript/langchain/short-term-memory
- LangChain Context engineering: https://docs.langchain.com/oss/javascript/langchain/context-engineering
- LangChain Built-in middleware: https://docs.langchain.com/oss/javascript/langchain/middleware/built-in
- LangChain Agents — Dynamic model: https://docs.langchain.com/oss/javascript/langchain/agents
- LangChain Models — Model profiles: https://docs.langchain.com/oss/javascript/langchain/models
- LangChain `trimMessages`: https://reference.langchain.com/javascript/langchain-core/messages/trimMessages
- LangGraph Memory: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LangGraph Persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence

## 15. 구현 진행 (2026-07-23)

Phase 0/1/2 구현 완료. 커밋은 아직 안 함(사용자 커밋 권한 대기). Phase 3부터 이어가면 된다.

### 15.1 변경된 파일

**Phase 1 (모델 실행 경쟁 조건 제거)**
- `src/ai/config.ts` — `resolveModelFromPreset()` 추출, `ModelRunConfig` 타입 + `resolveModelRunConfig(options)` 추가(`Object.freeze` 스냅샷). `getAiConfig`는 이 helper를 재사용하도록만 리팩터(동작 동일).
- `src/ai/client.ts` — `createChatModel(modelOverride?, { …, runConfig? })`. runConfig 있으면 전역 store 미조회. **번역/검수/폴리싱 호출부는 그대로**(runConfig 미전달 → 기존 경로).
- `src/ai/chat.ts` — `streamAssistantReply(input, runConfig, cb?)`. `getAiConfig` import 제거, `cfg.provider`→`runConfig.provider`. `runToolCallingLoop` 반환에 `usage: UsageInfo` 추가(각 step `finalAiMessage.usage_metadata` 누적). `StreamCallbacks.onUsage` 추가.
- `src/stores/chatStore.ai.ts` — `executeAiReply`/`/web` 모두 `resolveModelRunConfig({ preset: session?.modelPreset })`를 **한 번** 캡처해 threads. assistant placeholder metadata를 runConfig에서 생성(requestedModelPreset/resolvedModel/provider/reasoningEffort). `onUsage`로 토큰 반영.
- `src/types/index.ts` — `ChatMessageMetadata`에 requestedModelPreset/resolvedModel/provider/reasoningEffort/inputTokens/outputTokens/totalTokens/contextUtilization 추가(`model`은 `@deprecated` 읽기 호환).

**Phase 2 (세션별 모델 + UI 잠금)**
- `src/types/index.ts` — `ChatSession.modelPreset?: string`(optional, undefined=전역 상속).
- `src/stores/chatStore.session.ts` — `getDefaultModelPreset()`(=전역 chatModel). createSession/hydrate에서 modelPreset 백필. `setSessionModelPreset(sessionId, preset)` 액션(전역 chatModel 불변, schedulePersist).
- `src/stores/chatStore.types.ts` — `ChatActions.setSessionModelPreset` 시그니처.
- `src/components/chat/ChatContent.tsx` — Select를 세션 범위로: value=`session.modelPreset ?? chatModel`, onChange=`setSessionModelPreset`, `disabled={globalIsLoading}`. provider 비활성 세션 모델은 "현재" 그룹으로 노출(조용한 교체 금지). `pendingModelChange` → "다음 응답부터 적용" 힌트. `findPresetLabel()` 헬퍼.
- `src/components/chat/ChatMessageItem.tsx` — assistant 메시지에 모델 배지(`chat-message-model-badge`).
- `src/i18n/locales/{ko,en}.json` — chat.currentModelGroup / modelAppliesNext(+Title) / modelBadgeTitle.
- **Rust**: `models.rs` `ChatSession.model_preset: Option<String>`(serde `modelPreset`, skip_if_none). `db/schema.rs` `model_preset TEXT` 컬럼. `db/mod.rs` `run_migrations`에 `ALTER TABLE chat_sessions ADD COLUMN model_preset TEXT`(idempotent), save/load 쿼리에 컬럼 포함.

**테스트(신규)**: `src/ai/modelRunConfig.test.ts`(6), `src/stores/chatStore.sessionModel.test.ts`(5), `chatStore.integration.test.ts`에 메타데이터 일치 케이스 추가 + mock을 새 시그니처(runConfig 2nd arg, `resolveModelRunConfig` mock)로 갱신, Rust `db::tests::chat_session_model_preset_roundtrip_and_legacy_null`.

### 15.2 검증 상태

- `npx tsc --noEmit` ✅
- `npm run test:run` ✅ 928 passed / 8 skipped (67 files)
- `cargo test` ✅ 30 passed. **단, `utils::tests::validate_path_allows_file_in_temp_dir` 1개는 Claude 샌드박스 `$TMPDIR`(=/private/tmp/claude-501/…)를 system dir로 차단해서만 실패** — 내 변경과 무관. 일반 TMPDIR(`TMPDIR=<repo>/src-tauri/target/tmptest cargo test`)에선 30/30 통과 확인.
- **미실행(머지 전 권장)**: `npm run test:e2e:web`(Playwright, 세션 모델 selector UI), `npm run test:tauri`(릴리스 게이트 — 플랜상 Phase 4까지 끝난 뒤 실행).

### 15.3 설계 결정 · 의도적 편차

1. **modelPreset은 required 아닌 optional**로 뒀다(플랜 5.1은 required 표기). 이유: 다수 테스트/레거시 리터럴 churn 최소화 + undefined→전역 상속이 마이그레이션을 자연스럽게 처리. Rust는 `Option<String>`, SQLite는 nullable `TEXT`. createSession/hydrate가 항상 채우므로 런타임엔 사실상 항상 존재.
2. **ModelRunConfig는 lean**: capability profile/토큰 예산 필드는 Phase 3(context manager)에서 확장 예정. 지금은 requestedPreset/resolvedModel/provider/reasoningEffort/keys/maxRecentMessages만.
3. **createChatModel은 시그니처 파괴 대신 옵션 추가**(runConfig?)로 번역/검수/폴리싱 하위호환 유지 — "Surgical > Sweeping".
4. **ChatModelChangeEvent(§6.3) 미구현** — 별도 이벤트 저장 대신 메시지 metadata 차이로 UI 힌트만. 필요 시 Phase 3+에서 `session.events`로 추가.
5. **provider 'mock'** → getAiConfig/resolveModelRunConfig는 실제로 'mock'을 반환하지 않음(모델명 기반 provider 판정). metadata.provider엔 'openai'로 정규화 저장.

### 15.4 Phase 3 착수 시 주의

- `getAiConfig().maxRecentMessages`(sendMessage/replayMessage의 `slice(-20)`)와 `config.ts`의 `maxRecentMessages: 20`은 Phase 3에서 토큰 예산 기반으로 대체. `resolveModelRunConfig`에도 아직 `maxRecentMessages: 20` 하드코딩이 남아있음.
- `MAX_LOOP_MESSAGES = 80`(chat.ts)은 Phase 4까지 비상 상한으로 유지.
- 요약 모델은 **세션 채팅 모델과 분리된 저비용 런타임 모델**(플랜 §2.6) — 이 코드를 구현하는 모델과 무관.
- usage는 provider 실제값(사전 추정 아님). Phase 3에서 contextUtilization 계산 시 사전 추정치와 분리 기록(§12.5).

## 16. Phase 3 구현 진행 (2026-07-23)

Phase 3(장기 대화 요약/토큰 예산) 구현 완료. TDD로 각 모듈부터 통합까지 진행.

### 16.1 신규 모듈 (`src/ai/chatContext/`)

- `tokenBudget.ts` — CJK-aware heuristic 토큰 추정(`approxTokens`), 메시지 토큰 추정, `computeInputBudget`(usable = max - output - reserve, 요약 트리거 75%), 중앙 상수(MIN/MAX_RECENT_TURNS=8/12, IMAGE_TOKEN_COST, TOOL_SAFETY_RESERVE). 실제 토크나이저는 번들에 싣지 않음(§12.5 사전추정 ≠ 실사용).
- `modelCapabilities.ts` — `resolveModelCapabilities({resolvedModel, provider})` → maxInputTokens(컨텍스트 윈도우×0.9)/imageInputs/toolCalling/reasoningOutput/builtInWebSearch. provider 기본값 + prefix override registry(현재 비어있음, 모든 프리셋이 provider 기본과 동일).
- `conversationContext.ts` — 순수 플래너 `planConversationContext`. 전체 transcript를 (이미 요약된 prefix 제외) 최근 원문 윈도우(턴 수 상한 + 토큰 예산) + 요약 대상으로 분할. 원문 윈도우는 항상 user부터 시작. `{needsSummary, messagesToSummarize, recentRawMessages, summarizedThroughMessageId}` 반환.
- `summarizeConversation.ts` — `resolveSummaryModelRunConfig(base)`(=실행 provider의 저비용 프리셋: anthropic→Haiku 4.5, openai→Luna Medium; base의 API 키 상속), `summarizeConversation`(증분 요약, `<untrusted_conversation>` 경계, abort 전파, 빈 응답/실패 시 기존 요약 유지=무손실).

### 16.2 배선(수정 파일)

- `prompt.ts` — `PromptContext.conversationSummary`(시스템 `[이전 대화 요약]` 블록), `PromptOptions.imageInputs`(false면 history 이미지 제거).
- `chat.ts` — `GenerateReplyInput.conversationSummary` 스레드, `resolveModelCapabilities`로 imageInputs 전달, **`applyInputTokenGuard`**(모델 호출 직전 `trimMessages` 하드 가드: 예산 이내면 무손실 통과, 초과 시 strategy 'last'/startOn 'human'/includeSystem). 이미지 fallback 경로에도 적용.
- `chatStore.ai.ts` — `sendMessage`/`replayMessage`의 `slice(-20)` 제거 → **전체 prior 전달**. `executeAiReply`에서 planner 실행 + `needsSummary`면 `summarizeConversation`(abort/ownership 가드) → `updateSessionMemory` 영속 → `conversationSummary`를 `streamAssistantReply`에 전달. `getAiConfig` import 제거.
- `chatStore.session.ts` — `updateSessionMemory(sessionId, memory)` 액션(transcript 불변, schedulePersist). hydrate는 `...session`으로 memory 자동 캐리.
- `types/index.ts` — `ChatSession.memory?: ChatSessionMemory`, `ChatSessionMemory{summary, summarizedThroughMessageId, summaryUpdatedAt, summaryModel, summaryVersion}`.
- `config.ts` — `resolveModelFromPreset` export(요약 runConfig 파생용). `maxRecentMessages`는 `@deprecated`.
- **Rust**: `models.rs` `ChatSession.memory: Option<Value>`(serde "memory"), `db/schema.rs` `memory_json TEXT`, `db/mod.rs` 마이그레이션 ALTER TABLE + save/load에 컬럼 포함.
- `ChatContent.tsx` + i18n — 세션에 `memory.summary`가 있으면 "이전 대화 요약됨" 알림.

### 16.3 검증 상태

- `npx tsc --noEmit` ✅
- `npm run test:run` ✅ 959 passed / 8 skipped (71 files, Phase 3에서 +31 신규)
- `cargo test` ✅ 31 passed(신규 `chat_session_memory_roundtrip_and_legacy_null` 포함). 일반 TMPDIR(`TMPDIR=<repo>/src-tauri/target/tmptest`)에서 실행 시 `utils::validate_path...`도 통과(31/31).
- `npm run test:e2e:web` — 19 passed / 1 failed. **실패는 Phase 3 무관**: `user-story.spec.ts`가 OpenAI 토글 초기 `disabled`를 기대하나 로컬 `.env.local`의 `OPENAI_API_KEY`가 dev serve에 주입되어 토글이 `enabled`로 시작(환경 아티팩트). Phase 3는 설정/키 UI를 건드리지 않음.
- 커밋: 사용자 권한 대기(아직 커밋 안 함).

### 16.4 설계 결정 · 편차

1. **요약 모델 = 실행 provider의 저비용 프리셋**(고정 전역 프리셋 아님). 이유: 사용자가 한쪽 provider 키만 가질 수 있어 실행 provider의 키를 재사용해야 함. 같은 provider 안에서 채팅 모델을 바꿔도 요약 모델은 고정(§2 준수). provider 전환 시에만 요약 모델 provider도 따라감(키 제약상 불가피). 필요 시 별도 설정으로 확장 가능하게 `SUMMARY_PRESET_BY_PROVIDER` 중앙화.
2. **토큰은 heuristic 사전추정**(실 토크나이저 미번들). 하드 가드(`trimMessages`)도 동일 추정치 사용. 실 usage는 provider usage_metadata로 별도 기록(Phase 1에서 이미).
3. **요약은 인라인(전송 preflight)**: `needsSummary`일 때만, 그리고 증분(새 구간만)이라 지연/비용 제한적. "이전 대화 요약 중..." 상태 표시.
4. **`maxRecentMessages` 필드 유지(제거 대신 deprecate)**: 인터페이스/테스트 ~15곳 churn 회피(Surgical). 실제 절단 경로만 제거.
5. **capability override registry는 현재 비어있음**: 모든 현행 프리셋이 provider 기본 capability와 동일. 특성이 다른 모델 추가 시 등록.

### 16.5 Phase 4 착수 시 주의

- 오래된 tool result 축약(`[cleared: ...]`), tool/model call limit 중앙화, SQLite 100개 destructive clamp 제거/1,000 정렬, delete-all/reinsert → 증분 upsert 검토, 장기 대화 telemetry(contextUtilization 채우기), Chat E2E.
- `MAX_LOOP_MESSAGES = 80`은 Phase 4에서 token-aware guard 안정화 후 제거 판단.
- Rust `save_chat_sessions`는 여전히 세션당 100 메시지로 clamp(§3.4) — Phase 4에서 프런트 1,000과 정렬 필요. 현재 memory(요약)는 clamp와 무관하게 세션 레코드에 저장되므로, 100 초과 삭제돼도 요약은 보존됨.

## 17. Phase 4 구현 진행 (2026-07-23)

Phase 4(도구 context editing / 저장 정책 정리 / 관측) 핵심 4항목 구현 완료. 성능-upsert와 실 AI E2E는 의도적으로 연기.

### 17.1 변경 사항

1. **저장 정책 정렬 (최우선, 실데이터 손실 수정)**: `db/mod.rs` `save_chat_sessions`의 `MAX_MESSAGES_PER_SESSION` **100 → 1000**(프런트 `chatStore.types.ts`와 정렬). 재시작 시 100개 초과 transcript가 잘리던 문제 해소. 테스트 `chat_session_message_persistence_aligns_with_frontend_1000_cap`(150개 무손실, 1005→1000 clamp).
2. **오래된 tool result 축약**: `chat.ts::compressOldToolMessages(messages, toolNames, {keepRecent, maxChars})` — 최근 N개(+이번 turn 배치)와 임계값 이하는 원문, 그 외 대형 결과는 `[cleared: name | N chars | "head…"]`로 교체. 메시지 미제거 → AI tool_call↔ToolMessage 쌍 보존, 멱등. 루프에서 매 스텝 결과 push 직후 호출(`keepRecent = max(3, 이번 스텝 tool 수)`). `tool_call_id→name` 매핑(`toolCallNames`)으로 라벨. 단위 테스트 `chat.toolContext.test.ts`(3).
3. **한도 중앙화**: `DEFAULT_MAX_MODEL_STEPS=6`/`MAX_MODEL_STEPS_CAP=12`(run-level 호출) + `MAX_LOOP_MESSAGES=80`(context 크기 비상 상한) + `MAX_SAME_ERROR=2`를 한 곳에 그룹화·주석. `maxSteps` 인라인 매직넘버 제거. 동작 불변.
4. **telemetry**: `chatStore.ai.ts` onUsage에서 `contextUtilization = min(1, 실 inputTokens / capabilities.maxInputTokens)` 계산·저장(§12.5 실 usage 기반, 사전추정과 분리). 통합 테스트에 0<util≤1 검증 추가.

### 17.2 연기(rationale)

- **delete-all/reinsert → 증분 upsert**: 현 규모(persist 800ms 디바운스·로컬 SQLite·≤5세션×≤1000 메시지 = 최대 ~5000행)에서 병목 아님. YAGNI로 연기.
- **실 AI 장기대화 Chat E2E**: web 하니스는 AI를 stub → 요약 트리거를 실제로 태울 수 없음. 로직은 unit(`conversationContext`/`summarizeConversation`/`chat.toolContext`) + store 통합(요약 트리거·영속·무손실 fallback·telemetry)으로 커버. 실 모델 필요한 시나리오는 `npm run test:tauri`(릴리스 게이트)에서.

### 17.3 검증 상태

- `npx tsc --noEmit` ✅
- `npm run test:run` ✅ 962 passed / 8 skipped (72 files, Phase 4에서 +3)
- `cargo test` ✅ 32 passed (신규 clamp 정렬 테스트 포함; `TMPDIR=<repo>/src-tauri/target/tmptest`)
- 릴리스 게이트 `npm run test:tauri`는 배포 전 사용자가 실행.

