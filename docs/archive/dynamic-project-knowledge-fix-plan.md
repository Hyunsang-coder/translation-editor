# 동적 프로젝트 지식(Project Memory) 수정 계획 (2026-07-27)

> **구현 상태: ✅ D1–D7, D9 완료 (2026-07-27)** — 커밋 `e229e9b`(D1/D2), `f866564`(D3), `2638304`(D4/D5/D7), `68e9711`(D6), D9.
> 검증: `npx tsc --noEmit`, `npm run test:run` (1078 passed, 8 skipped / 94 files).
> 미적용: D8-4(웹 E2E 시나리오) — 사용자 합의로 범위 제외. 아래 "구현 결과" 참조.

> 대상: v2.13.0 "Dynamic project knowledge" 도입 이후의 채팅 ↔ Project Memory/금칙어/용어집 갱신 루프.
> 저장·승인·스냅샷 계층(SQLite `project_memory_state` revision, no-op proposal tool, workflow ContextSnapshot 고정)은 의도대로 동작함이 확인되었고, 이 문서는 **그 위에 얹힌 채팅 루프가 닫히지 않은 부분**만 다룬다.
> 원 설계 문서: `docs/selection-editing-and-dynamic-context-plan.md` (§13 동적 Project Memory, §14 Workflow별 Context Resolver).
> 구현 시 준수: Surgical > Sweeping (여기 명시된 변경만), 기존 스타일 유지, 완료 전 `npx tsc --noEmit` + `npm run test:run` (+Rust 변경 시 `cargo test`).

## 우선순위 요약

| # | 상태 | 심각도 | 파일 | 요약 |
|---|------|--------|------|------|
| D1 | ✅ | P0 기능 후퇴 | `src/ai/prompt.ts:398` / `src/stores/chatStore.ai.ts:307` | 승인된 Project Memory가 일반 채팅 시스템 프롬프트에 주입되지 않음 (tool pull 전용) |
| D2 | ✅ | P1 죽은 경로 | `src/components/chat/ChatMessageItem.tsx:500` / `ChatContent.tsx:354` | `[Add to Context]` 버튼이 어디에도 쓰이지 않는 `chatStore.projectContext`에 기록 |
| D3 | ✅ | P1 데이터 유실 | `src/stores/chatStore.ai.ts:462` | 한 응답에 제안이 여러 건이면 종류별 마지막 1건만 남고 나머지 덮어쓰기 |
| D4 | ✅ | P2 UX | `src/components/chat/ChatContent.tsx:518` / `src/tauri/projectMemory.ts:58` | Rust가 돌려주는 `duplicate` 플래그를 UI가 무시, 유사 항목 충돌 감지 미구현 |
| D5 | ✅ | P2 정합성 | `src/components/chat/ProjectKnowledgeProposalCards.tsx:77` | 승인 버튼에 in-flight 가드 없음 (`saving` 미전달) → 더블클릭 시 중복 쓰기 |
| D6 | ✅ | P2 토큰 | `src/ai/context/buildContextSnapshot.ts:22` | active 메모리 전량 주입 (개수 cap·카테고리 필터 없음), pull 경로와 정책 불일치 |
| D7 | ✅ | P3 방어 | `src/components/chat/ChatContent.tsx:518` | 메모리/금칙어/용어집 proposal에 `projectId` 가드 없음 (selection proposal에는 있음) |
| D8 | 부분 | P3 테스트 | — | tool call → proposal 카드 → 승인 → DB → 다음 요청 반영 경로의 테스트 부재 |
| D9 | ✅ | P1 일관성 | `src/types/index.ts:238` / `src/stores/chatStore.ai.ts:217` | 문서를 고칠 수 있는 두 경로(직접 재번역·선택 채팅)에만 번역 규칙·금칙어가 안 들어감 |

**검토했으나 수정 불필요로 판단한 항목**:
- "워크플로우 도중 메모리를 승인하면 진행 중 번역이 오염된다" — **해당 없음.** `EditorCanvasTipTap.tsx:860`, `:994`, `ReviewPanel.tsx:227`, `:552`가 작업 시작 시 `useProjectMemoryStore.getState()`를 캡처해 `buildContextSnapshot`으로 고정하므로 모든 chunk가 동일 revision을 공유한다. 설계 의도대로임.
- "채팅 한 턴 안에서 tool이 읽는 메모리와 manifest revision이 어긋난다" — **해당 없음.** `chat.ts:847`이 요청 조립 시점에 `memoryState`를 한 번 캡처해 tool closure에 넘기고, `chatStore.ai.ts:307`도 같은 시점 revision을 기록한다. 턴 내부는 일관적이다.
- "`hydrate` 경합으로 이전 프로젝트 메모리가 남는다" — **해당 없음.** `projectMemoryStore.ts:53`의 `hydrationSequence` + `activeProjectId` 이중 검사로 stale 응답을 폐기한다.

## 구현 결과 (2026-07-27)

### 계획과 달라진 점

1. **D6 — 카테고리 하드 제외 대신 우선순위 정렬.** 설계 문서 §14.3은 full-translate에 `domain/audience/product/worldbuilding/character/decision`만 넣기로 했으나 채택하지 않았다. 구현 중 확인해보니 legacy 마이그레이션(`db/mod.rs:2883`, `category='general'`)과 설정 UI 수동 추가(`ProjectMemorySettingsSection.tsx`, 기본값 `'general'`)가 모두 `general`로 들어온다. 하드 제외하면 마이그레이션된 기존 프로젝트 컨텍스트와 사용자가 직접 넣은 항목이 통째로 빠진다. `MEMORY_CATEGORY_PRIORITY`는 상한에 걸렸을 때의 정렬 기준으로만 쓰고, 카테고리로 배제하지는 않는다.

2. **D6 — `droppedCount` manifest 필드 보류.** ContextManifest를 렌더링하는 곳이 `SelectionEditPreviewModal.tsx:174`의 `included.join(' · ')` 하나뿐이라, 읽는 쪽 없이 필드만 늘리면 D4에서 문제 삼은 `duplicate` 플래그와 같은 상황이 된다. `selectMemoryItems`/`renderSnapshotMemory`는 `droppedCount`를 이미 돌려주므로 표시 UI가 생길 때 배선하면 된다.

3. **D2 — 계획에 없던 dead reference 추가 정리.** `suggest_project_context`의 tool progress 라벨이 `ChatContent.tsx`와 `ChatMessageItem.tsx`에 남아 있어 i18n 키와 함께 제거했다.

4. **D4 — token similarity 충돌 감지는 미착수.** 계획대로 `duplicate` 노출까지만 했다. 후속 항목으로 남긴다(아래).

### 남은 작업

- **D8-4**: `e2e/tauri-mock.ts`에 `propose_project_memory_change` 마커 에코를 추가해 생성 → 승인 → Settings 반영을 웹 E2E로 검증. 사용자 합의로 이번 범위에서 제외.
- **D4 후속**: 같은 category 내 token similarity(Dice ≥ 0.6, 상위 3건) 후보를 `add_project_memory_item`이 함께 반환하고, 카드에서 "교체 / 새로 추가"를 제공 (설계 문서 §13.5 3~4단계).
- **정리**: `prompt.ts:451`의 `buildTranslateOnlyMessages`는 호출부가 0건인 dead export다.

### 검증 메모

`npm run test:e2e:web`은 이번 세션에서 실행하지 못했다. 개발자의 `npm run dev`(vite)가 HMR용으로 1421 포트를 점유하는데(`vite.config.ts:145`) 웹 harness도 같은 포트에 서버를 띄우려 해서(`playwright.web.config.ts:28`) 충돌한다. 개발 서버를 내린 뒤 실행하거나, harness 포트를 1421에서 옮기는 것을 검토할 것.

---

## D1. 승인된 Project Memory가 일반 채팅에 주입되지 않음

### 진단

일반 채팅의 시스템 컨텍스트는 `prompt.ts`에서 다음 항목만 조립한다.

```398:410:src/ai/prompt.ts
  const systemContext = [
    translationRules,
    glossaryInjected,
    projectContext,
    conversationSummary,
    sourceDoc,
    targetDoc,
    formatAttachments(ctx.attachments),
    blockContext,
    selectionProfile,
  ]
    .filter(Boolean)
    .join('\n\n');
```

여기서 `projectContext`는 legacy 필드이고 `chatStore.ai.ts`가 `streamAssistantReply`에 더 이상 넘기지 않으므로(v2.13.0에서 제거) 항상 빈 문자열이다. 즉 **Translation Rules와 glossary는 push되지만 Project Memory와 금칙어는 push되지 않는다.** 유일한 접근 경로는 `get_project_guidance` tool이고, 도구 가이드는 한 줄뿐이라 호출 유인이 약하다.

```963:965:src/ai/chat.ts
  if (has('get_project_guidance')) {
    toolGuide.push('- get_project_guidance: 필요한 규칙·금칙어·프로젝트 메모리 섹션만 조회.');
  }
```

결과: 사용자가 채팅에서 "이 프로젝트는 SF 세계관이야"를 메모리로 승인해도, 바로 다음 턴에서 모델이 도구를 부르지 않으면 그 사실을 모른다. 사용자 입장에서는 "승인했는데 AI가 기억을 못 한다"로 보인다.

설계 문서 §14.1의 MVP 전환 전략은 다음과 같았다.

> 1. general chat은 기존 자동 주입을 유지
> 2. selection chat부터 최소 주입 적용
> 3. 관측 데이터 확보 후 general chat도 compact summary + tool 방식으로 전환

구현은 legacy `projectContext` 주입을 제거하면서 1단계를 건너뛰고 3단계로 갔는데, 3단계의 핵심인 **compact summary가 빠졌다.** 그래서 일반 채팅의 프로젝트 지식이 v2.13.0 이전보다 후퇴했다.

### 수정안

1. `src/ai/context/` 에 compact summary 렌더러를 추가한다. `resolveWorkflowContextFromSnapshot`의 `rendered.projectMemory` 포맷(`- [category] content`)을 재사용하되 채팅용 상한을 둔다.
   ```ts
   // src/ai/context/renderChatMemoryDigest.ts (신규)
   export interface ChatMemoryDigestInput {
     items: ProjectMemoryItem[];
     forbiddenTerms: ForbiddenTerm[];
     maxItems?: number;      // 기본 12
     maxChars?: number;      // 기본 1500
   }
   /** 일반 채팅 시스템 프롬프트에 넣을 압축 요약. 빈 문자열이면 주입하지 않는다. */
   export function renderChatMemoryDigest(input: ChatMemoryDigestInput): {
     text: string;
     itemIds: string[];
     forbiddenTermIds: string[];
     truncated: boolean;
   }
   ```
   - 항목 선택 우선순위: D6에서 정하는 카테고리 우선순위와 동일한 함수를 공유한다(중복 구현 금지).
   - `maxChars` 초과 시 잘라내고 `truncated: true`를 반환한다.

2. `chatStore.ai.ts`의 `executeAiReply`에서 selection 요청이 아닐 때만 digest를 만들어 `streamAssistantReply`에 넘긴다. `translationRules`와 동일하게 `maskGhostChips`를 통과시켜야 한다(ghost chip 무결성).
   ```ts
   const memoryState = useProjectMemoryStore.getState();
   const memoryDigest = isSelectionRequest
     ? { text: '', itemIds: [], forbiddenTermIds: [], truncated: false }
     : renderChatMemoryDigest({
         items: memoryState.items,
         forbiddenTerms: memoryState.forbiddenTerms,
       });
   const projectMemoryDigest = memoryDigest.text
     ? maskGhostChips(memoryDigest.text, maskSession)
     : '';
   ```
   - `reservedContextTokens`(`chatStore.ai.ts:256`)에 `approxTokens(projectMemoryDigest)`를 더한다. 빠뜨리면 요약 트리거 예산이 어긋난다.
   - `contextManifest` 초기값(`:308-325`)에 반영: digest가 있으면 `included`에 `'project-memory'`(금칙어가 포함됐다면 `'forbidden-terms'`도) 추가, `projectMemoryItemIds`/`forbiddenTermIds`를 digest가 돌려준 ID로 채운다. 현재 빈 배열로 초기화되고 tool 호출 시에만 채워지는데, push된 항목도 manifest에 나타나야 ContextManifest UI가 정확해진다.

3. `chat.ts`의 `StreamAssistantReplyInput`과 `prompt.ts`의 `BuildLangChainMessagesContext`에 `projectMemoryDigest?: string`를 추가하고, `formatTranslationRules`와 같은 모양의 `formatProjectMemoryDigest`(헤더 `[프로젝트 메모리]`)를 만들어 `systemContext` 배열에서 `translationRules` **다음**에 배치한다. 상한은 `LIMITS`에 `projectMemoryDigestChars: 4000`을 추가.

4. 채팅 경로의 legacy `projectContext` 슬롯을 정리한다(D2와 짝을 이룸). `streamAssistantReply`의 유일한 호출부인 `chatStore.ai.ts:601`이 `projectContext`를 넘기지 않으므로, `systemContext` 배열의 `projectContext` 항목(`prompt.ts:383`, `:401`)과 `formatProjectContext`(`:220`), `LIMITS.projectContextChars`, `StreamAssistantReplyInput.projectContext`(`chat.ts:168`), `chat.ts:1193`의 전달, `BuildLangChainMessagesContext.projectContext`(`prompt.ts:106`)는 전부 dead다.
   - 주의: `reviewTool.ts:381`, `translateDocument.ts:679`, `polishDocument.ts:178`의 `projectContext`는 **이름만 같은 별개 파라미터**(workflow `resolvedContext`에서 옴)다. 건드리지 말 것.
   - `prompt.ts:451`의 `buildTranslateOnlyMessages`도 호출부가 0건인 dead export지만 이번 범위 밖이다. 별도로 정리한다.

5. 도구 가이드 문구를 보강한다. digest는 요약이므로 상세가 필요하면 tool을 부르라는 신호가 있어야 한다.
   ```ts
   toolGuide.push('- get_project_guidance: [프로젝트 메모리] 요약에 없는 규칙·금칙어·메모리 상세가 필요할 때 조회.');
   ```

### 검증

- 신규 `src/ai/context/renderChatMemoryDigest.test.ts`: 카테고리 우선순위 정렬, `maxItems`/`maxChars` 절단, active 항목만 포함(`archived` 제외), 빈 입력 시 빈 문자열.
- `src/ai/context/aiDryRun.ts` 경로로 일반 채팅 payload를 dry-run 하여 `[프로젝트 메모리]` 블록이 실제 시스템 메시지에 들어가는지 확인(`/test-ai` 스킬).
- 수동: 채팅에서 메모리 제안 승인 → 새 메시지 전송 → 도구 호출 없이도 응답이 해당 사실을 반영, ContextManifest에 `project-memory` 표시.

---

## D2. `[Add to Context]` 버튼이 죽은 경로에 기록

### 진단

Suggested Context 카드는 여전히 렌더링되고, 클릭하면 `appendToProjectContext`로 흘러간다.

```500:527:src/components/chat/ChatMessageItem.tsx
          {/* Suggested Context 카드 */}
          {message.metadata?.suggestedContext && !message.metadata.contextAdded && (
```

`ChatContent.tsx:354-356` → `chatStore.settings.ts:167` → `chatStore.projectContext`에 저장되고 DB에도 persist된다. 그런데 이 값이 실제로 쓰이는 곳은 workflow의 legacy fallback 하나뿐이다.

```25:32:src/ai/context/buildContextSnapshot.ts
  const legacyProjectContext = input.legacyProjectContext?.trim();
  if (activeProjectMemoryItems.length === 0 && legacyProjectContext) {
    activeProjectMemoryItems.push({
      id: 'legacy-project-context',
      category: 'general',
      content: legacyProjectContext,
    });
  }
```

**메모리 항목이 하나라도 생기면 이 fallback은 영구히 죽는다.** `projectMemoryStore.hydrate`의 마이그레이션도 `snapshot.items.length === 0`일 때만 돌기 때문에(`projectMemoryStore.ts:96-105`), 그 이후 append된 내용은 옮겨지지도 않는다.

`suggest_project_context` tool은 `CHAT_TOOL_REGISTRY`에 없어 bind되지 않지만, 텍스트 기반 폴백이 여전히 `suggestedContext`를 만들어내므로 버튼은 실제로 뜬다.

```648:653:src/stores/chatStore.ai.ts
        if (!currentMetadata.suggestedRule && !currentMetadata.suggestedContext) {
          const inferred = inferSuggestionFromAssistantText(restored);
          if (inferred) {
            set({ streamingMetadata: { ...currentMetadata, ...inferred } });
          }
        }
```

### 수정안

`[Add to Context]`를 제거하고 승인 기반 Project Memory로 일원화한다. (`[Add to Rules]`는 `translationRules`가 실제로 주입되므로 **유지**한다.)

1. `chatStore.helpers.ts`의 `inferSuggestionFromAssistantText`에서 context 분기 제거: 반환 타입을 `{ suggestedRule?: string } | null`로 좁히고 `contextTrigger`/`hasContext` 관련 코드를 삭제. `chatStore.helpers.test.ts`의 context 케이스 3개도 함께 정리.
2. `chatStore.ai.ts:522-528`의 `suggest_project_context` 분기 삭제.
3. `ChatMessageItem.tsx`의 Suggested Context 카드 블록(`:500-527`)과 `onAppendToContext` prop, `chatStore.selectors.ts:90`의 `appendToProjectContext` 노출, `ChatContent.tsx`의 `handleAppendToContext` 제거.
4. `src/ai/tools/suggestionTools.ts`의 `suggestProjectContext` export 삭제(어디서도 import되지 않음을 확인 후).
5. `types/index.ts`의 `suggestedContext`/`contextAdded` 필드는 **남긴다.** 기존 세션 메시지에 이미 저장돼 있어 제거하면 hydrate 시 타입이 깨진다. JSDoc에 `@deprecated 2026-07-27 — 표시하지 않음, 과거 메시지 호환용`을 명시.
6. store의 `projectContext` 상태·`setProjectContext`/`appendToProjectContext` 세터·DB persist는 **남긴다.** Desktop MCP `oddeyes_set_translation_context`(`oddeyesAppBridge.ts:315`)가 계약상 쓰고 있고, `buildContextSnapshot`의 legacy fallback이 아직 유효하다. MCP 파라미터 제거는 차기 MCP 버전업 때.
7. i18n: `chat.suggestedContext`, `chat.addToContext`, `chat.addToContextButton` 키를 `ko.json`/`en.json` 양쪽에서 제거.

### 검증

- `npx tsc --noEmit` — prop 제거 누락 시 여기서 잡힌다.
- `chatStore.helpers.test.ts` 갱신 후 통과.
- 수동: AI가 "[Add to Context]" 문구를 포함한 응답을 해도 버튼이 뜨지 않고, 대신 `propose_project_memory_change` 카드로 유도되는지.

---

## D3. 한 응답에 제안이 여러 건이면 마지막 1건만 남음

### 진단

proposal은 `ChatMessageMetadata`의 단일 필드에 기록된다.

```471:486:src/stores/chatStore.ai.ts
              nextMetadata = {
                ...nextMetadata,
                projectMemoryProposal: {
                  proposalId: uuidv4(),
                  operation,
```

`suggest_forbidden_term`(`:487`), `suggest_glossary_entry`(`:500`)도 같은 구조다. 모델이 한 턴에서 메모리 변경 3건을 제안하면 앞의 2건은 조용히 덮어써진다. 바로 위 `suggestedRule`(`:515-521`)은 `;`로 이어붙이는데 신규 proposal만 그렇지 않아 처리가 비대칭이다.

"이번 대화에서 정리된 내용을 메모리에 넣어줘" 같은 요청이 정확히 이 케이스다. 대화 요약 기반 지식 축적이라는 기능의 핵심 시나리오가 막혀 있다.

### 수정안

metadata를 배열로 바꾸고 렌더링을 리스트화한다.

1. `types/index.ts`에 배열 필드를 **추가**한다(기존 단수 필드는 과거 메시지 호환용으로 유지, `@deprecated` 표기).
   ```ts
   projectMemoryProposals?: ProjectMemoryChangeProposal[];
   forbiddenTermProposals?: ForbiddenTermProposal[];
   glossaryEntryProposals?: GlossaryEntryProposal[];
   ```
2. `chatStore.ai.ts`의 세 분기를 append로 변경.
   ```ts
   projectMemoryProposals: [...(nextMetadata.projectMemoryProposals ?? []), proposal],
   ```
   같은 turn에서 동일 내용이 반복 호출될 수 있으므로 `(operation, category, content, targetItemId)` 조합이 이미 있으면 skip한다.
3. `ProjectKnowledgeProposalCards`가 배열을 받아 `proposalId`를 key로 map 렌더링하도록 변경. 콜백 시그니처에 `proposalId`를 추가한다.
4. 읽기 측 하위 호환: `ChatMessageItem`에서 `metadata.projectMemoryProposals ?? (metadata.projectMemoryProposal ? [metadata.projectMemoryProposal] : [])`로 정규화하는 헬퍼를 하나 두고 세 종류 모두 통과시킨다.
5. `ChatContent`의 apply/dismiss 핸들러가 `proposalId`로 배열 내 해당 항목만 갱신하도록 수정. 단수 필드에서 온 legacy proposal은 승인 시 배열로 승격시키지 말고 기존 단수 필드를 갱신한다(경로 분기 최소화).
6. `ChatMessageItem`의 `memo` 비교 함수(`:554-556`)에 신규 배열 필드 3개 참조 비교 추가.

### 검증

- 신규 테스트: 한 스트림에서 `propose_project_memory_change`를 서로 다른 args로 3회 호출 → metadata에 3건 누적, 동일 args 중복 호출 → 1건.
- 렌더링 테스트: 3건이 카드 3개로 표시되고, 2번째만 승인 시 나머지 2건이 `proposed`로 남는지.
- 하위 호환: 단수 필드만 있는 legacy 메시지가 카드 1개로 정상 렌더링·승인되는지.

---

## D4. `duplicate` 플래그 미노출 + 유사 항목 충돌 감지 미구현

### 진단

Rust는 `(project_id, category, normalized_hash)` exact match로 중복을 판정해 기존 항목과 `duplicate: true`를 돌려준다(`db/mod.rs:2588-2594`). 이 값은 `AddProjectMemoryItemResult.duplicate`(`commands/project_memory.rs:65`) → `AddProjectMemoryResult.duplicate`(`src/tauri/projectMemory.ts:58`)까지 타입으로 이어지는데, **프론트엔드에서 이 필드를 읽는 코드가 없다**(`projectMemoryStore.test.ts` 외 참조 0건).

사용자는 "추가"를 눌러 성공 표시를 받지만 실제로는 기존 항목이 반환됐을 수 있다. revision도 증가하지 않아 "승인했는데 rev가 그대로"인 상태가 된다.

설계 문서 §13.4/§13.5는 다음을 요구한다.

> `add`: exact normalized hash 중복이면 기존 항목 표시 / 유사 category 항목이 있으면 replace/add 선택 제공
> MVP: 1. normalize 2. hash exact match 3. 같은 category 내 단순 token similarity 4. 충돌 가능 항목을 사용자에게 함께 표시

1~2는 구현됐고 **3~4는 미구현**이다(`db/mod.rs`에 similarity 관련 코드 없음).

### 수정안

이번 라운드는 `duplicate` 노출까지만 하고, token similarity는 별도 항목으로 분리한다(범위 통제).

1. `ChatContent.applyMemoryProposal`이 `addItem`/`replaceItem` 결과를 받아 분기한다.
   ```ts
   const result = await memoryStore.addItem(input);
   if (result.duplicate) {
     addToast({ type: 'info', message: t('memory.alreadyExists', '이미 동일한 메모리가 있습니다.') });
   }
   ```
   `duplicate`여도 proposal status는 `applied`로 둔다(사용자 의도는 반영됐고, 카드가 계속 남아 있으면 혼란스럽다).
2. `ProjectMemorySettingsSection.handleAdd`도 동일하게 처리한다. 수동 추가 시 입력이 지워지는데 아무 일도 안 일어나면 더 헷갈린다.
3. `ko.json`/`en.json`에 `memory.alreadyExists` 추가.

**후속(별도 커밋)**: 같은 category 내 token similarity 후보 표시. Rust `add_project_memory_item`이 `similar: Vec<ProjectMemoryItemRow>`를 함께 반환하고(Dice 계수 ≥ 0.6, 상위 3건), 카드에서 "유사 항목이 있습니다 → 교체 / 새로 추가"를 제공한다. 이건 D1–D5 완료 후 착수한다.

### 검증

- `projectMemoryStore.test.ts`에 이미 `duplicate: true` 목이 있으므로, `ChatContent` 쪽 토스트 호출 테스트를 추가.
- 수동: 같은 내용을 두 번 승인 → 두 번째에 안내 토스트, 목록에 항목 1개, rev 불변.

---

## D5. 승인 버튼에 in-flight 가드 없음

### 진단

`applyMemoryProposal`은 `await` 완료 후에야 status를 `applied`로 바꾸고(`ChatContent.tsx:550-554`), 카드는 `status === 'proposed'`일 때만 렌더링된다. 그 사이 버튼은 계속 눌린다.

```77:83:src/components/chat/ProjectKnowledgeProposalCards.tsx
            <ActionButton primary onClick={() => onApplyMemory('requested')}>
              {memory.operation === 'archive'
                ? t('memory.archive', '보관')
```

store에 `saving` 플래그가 있지만(`projectMemoryStore.ts:24`) 이 컴포넌트는 받지 않는다. `add`는 hash 중복으로 DB가 막아주지만, `replace`/`archive`는 두 번째 호출이 "이미 archived" 에러 토스트로 튄다. 용어집 `createEntry`에는 그런 보호도 없어 항목이 2개 생긴다.

`ProjectMemorySettingsSection`은 이미 `disabled={saving || !content.trim()}`로 올바르게 처리하고 있으므로, 채팅 카드만 같은 수준으로 맞추면 된다.

### 수정안

1. `ProjectKnowledgeProposalCards`에 `busy?: boolean` prop을 추가하고 `ActionButton`에 `disabled` + `disabled:opacity-50`을 전달한다.
2. `ChatMessageItem`이 `useProjectMemoryStore((s) => s.saving)`를 구독해 내려준다. 용어집은 `useGlossaryStore`의 대응 플래그를 확인해 함께 반영하고, 없으면 `ChatContent`에 로컬 `applyingProposalId` state를 두고 그 값으로 대신한다(store 확장보다 국소적).
3. `ChatMessageItem`의 `memo` 비교에 `busy` 반영.

### 검증

- 테스트: apply 콜백이 resolve되기 전 두 번째 클릭이 무시되는지.
- 수동: 느린 네트워크(devtools throttle)에서 연타 → 항목 1개.

---

## D6. 메모리 주입량에 상한·카테고리 필터 없음

### 진단

snapshot은 active 항목 전량을 담고, resolver도 전부 렌더링한다.

```22:24:src/ai/context/buildContextSnapshot.ts
  const activeProjectMemoryItems = input.projectMemoryItems
    .filter((item) => item.status === 'active')
    .map(({ id, category, content }) => ({ id, category, content }));
```

```48:53:src/ai/context/resolveWorkflowContext.ts
  if (useProjectMemory && snapshot.projectMemoryItems.length > 0) {
    rendered.projectMemory = snapshot.projectMemoryItems
      .map((item) => `- [${item.category}] ${item.content}`)
      .join('\n');
    included.push('project-memory');
  }
```

반면 pull 경로인 `get_project_guidance`는 `.slice(0, 30)`이 걸려 있다(`projectGuidanceTools.ts:59`, `:71`). **같은 데이터에 대해 push와 pull의 정책이 다르다.**

설계 문서 §14.3은 full-translate에 `domain/audience/product/worldbuilding/character/decision`만 넣기로 했는데, 실제로는 `intent`·`reference_fact`·`general`도 전부 들어간다. 항목당 5,000자까지 허용되므로(`proposalTools.ts:37`) 장기 프로젝트에서 조용히 토큰을 잠식한다.

### 수정안

1. `src/ai/context/`에 우선순위 정책을 한 곳에 정의한다. D1의 digest와 반드시 공유할 것.
   ```ts
   // src/ai/context/projectMemoryPolicy.ts (신규)
   export const MEMORY_CATEGORY_PRIORITY: Record<ProjectMemoryCategory, number>;
   /** mode별 허용 카테고리. 설계 문서 §14.3 기준. */
   export function allowedCategories(mode: WorkflowContextMode): Set<ProjectMemoryCategory>;
   /** 우선순위 정렬 후 상한 적용. 잘린 개수를 함께 반환. */
   export function selectMemoryItems<T extends { category: ProjectMemoryCategory }>(
     items: T[], mode: WorkflowContextMode, maxItems: number,
   ): { selected: T[]; droppedCount: number };
   ```
2. `resolveWorkflowContextFromSnapshot`에서 렌더링 전에 `selectMemoryItems`를 적용한다. **`buildContextSnapshot`은 건드리지 않는다** — snapshot은 "그 시점의 프로젝트 지식 전체"라는 의미를 유지해야 하고, 무엇을 쓸지는 mode를 아는 resolver의 책임이다. `manifest.projectMemoryItemIds`도 실제 선택된 항목만 담도록 맞춘다(현재는 snapshot 전체를 그대로 넣고 있어 실제 주입분과 어긋난다).
3. 상한값은 mode별로: full-translate/review/polish 40, general-chat digest 12(D1), selection-retranslate 20.
4. `droppedCount > 0`이면 `ContextManifest`에 표시할 수 있도록 필드를 하나 추가하는 것을 검토한다(선택). 사용자가 "메모리를 넣었는데 반영이 안 된다"고 느낄 때 진단 단서가 된다.

### 검증

- `resolveWorkflowContext.test.ts`에 케이스 추가: 카테고리 필터가 mode별로 동작, 상한 초과 시 우선순위 높은 항목이 남고 `manifest.projectMemoryItemIds`가 실제 렌더링분과 일치.
- 기존 `resolveWorkflowContext.test.ts` / `translateDocument.test.ts` / `polishDocument.test.ts` / `runReview.test.ts` 통과 확인 (snapshot 형태를 바꾸지 않으므로 영향 없어야 함).

---

## D7. 메모리 proposal에 projectId 가드 없음

### 진단

selection proposal은 적용 전 프로젝트 일치를 검사한다.

```471:477:src/components/chat/ChatContent.tsx
    if (
      !editor ||
      activeProject?.id !== proposal.projectId ||
      !anchor ||
```

반면 `applyMemoryProposal`(`:518`)과 `applyForbiddenTermProposal`(`:563`)은 `sourceSessionId`만 갖고 apply 시점의 활성 프로젝트에 그대로 쓴다. 채팅 세션이 프로젝트 단위로 재로드되므로 실무에서 터지기는 어렵지만, 방어 수준이 종류별로 다른 상태다.

### 수정안

1. `ProjectMemoryChangeProposal`/`ForbiddenTermProposal`/`GlossaryEntryProposal`에 `projectId?: string`를 추가하고, `chatStore.ai.ts`에서 proposal 생성 시 `project?.id`를 기록한다(이미 `executeAiReply` 스코프에 `project`가 있다).
2. 세 apply 핸들러 앞에 공통 가드를 둔다. `projectId`가 없는 legacy proposal은 통과시킨다(하위 호환).
   ```ts
   if (proposal.projectId && useProjectStore.getState().project?.id !== proposal.projectId) {
     addToast({ type: 'error', message: t('memory.projectChanged', '프로젝트가 변경되어 적용할 수 없습니다.') });
     return;
   }
   ```
3. `ko.json`/`en.json`에 `memory.projectChanged` 추가.

### 검증

- 테스트: proposal의 projectId와 활성 프로젝트가 다르면 store 쓰기가 호출되지 않는지.

---

## D8. proposal → 승인 → 반영 경로 테스트 부재

### 진단

현재 커버리지는 두 끝단만 있다.

- `src/stores/projectMemoryStore.test.ts` — store ↔ tauri 레이어 (hydrate 경합, add/replace/archive, revision)
- `src/ai/tools/resolveChatTools.test.ts` — profile별 allowlist
- `src-tauri/src/db/mod.rs::project_memory_dedup_replace_forbidden_clone_and_cascade` — DB 레벨

**중간이 비어 있다.** tool call 이벤트가 proposal 카드로 변환되는지, 승인이 store에 도달하는지, 승인 결과가 다음 요청 컨텍스트에 나타나는지를 검증하는 테스트가 없다. D1–D3이 눈에 띄지 않은 이유이기도 하다.

### 수정안

1. **단위** — `chatStore.ai` 스트림 콜백 테스트: mock `streamAssistantReply`가 `onToolCall({ phase: 'start', toolName: 'propose_project_memory_change', args })`를 발화 → 메시지 metadata에 proposal 생성. D3의 다중 제안 케이스 포함.
2. **단위** — `ChatContent`의 apply 핸들러: proposal + mock store → `addItem`/`replaceItem`/`archiveItem` 호출 인자 검증, 실패 시 토스트, status 전이(`proposed → applied`, `→ dismissed`).
3. **통합** — D1 완료 후: 메모리 승인 → 다음 `executeAiReply` payload에 `[프로젝트 메모리]` 블록과 해당 내용이 포함되는지. `src/ai/context/aiDryRun.ts`를 활용하면 실제 API 호출 없이 검증 가능.
4. **E2E(선택)** — `e2e/tauri-mock.ts`에 `propose_project_memory_change` 마커 에코를 추가해 웹 E2E로 생성 → 승인 → Settings 목록 반영까지 확인. selection editing이 같은 방식으로 검증되고 있다(`e2e/selection-editing.spec.ts`).

### 검증

- `npm run test:run` 통과, 신규 테스트가 D1/D3 수정 전에는 실패하고 후에는 통과하는지 확인(TDD 순서 권장 — `/tdd` 스킬).

---

## D9. 부분 수정 경로에 전역 제약이 빠짐

### 진단

번역사가 문장 하나를 고치는 경로가 셋인데, 규칙이 적용되는 경로와 문서를 고칠 수 있는 경로가 어긋나 있었다.

| 경로 | 번역 규칙 | 문서 수정 |
|------|-----------|-----------|
| 직접 부분 재번역 | 기본 꺼짐, 선택마다 재체크 | 가능 |
| 선택 영역 채팅 | 미주입 (tool 호출 시에만) | 가능 |
| 일반 채팅 | 자동 주입 | 불가 |

`DEFAULT_SELECTION_REFERENCE_OPTIONS`가 네 항목 모두 `false`였고, 새 선택마다 `{ ...DEFAULT_SELECTION_REFERENCE_OPTIONS }`로 초기화돼(`EditorCanvasTipTap.tsx:585`) 체크를 켜도 다음 문장에서 다시 꺼졌다. 선택 채팅은 `translationRulesRaw = isSelectionRequest ? '' : ...`로 규칙을 아예 비웠다.

설계 문서 §1.2의 "선택 채팅은 불필요한 프로젝트/문서 컨텍스트를 자동 주입하지 않는다"를 규칙에까지 적용한 결과인데, 배제 기준이 잘못됐다. 용어집·프로젝트 메모리는 크고 질의 의존적이라 on-demand가 맞지만, 문체·톤 규칙과 금칙어는 **모든 문장에 예외 없이 적용되는 전역 제약**이고 실제 크기도 수백 자다.

이 조합의 위험은 실패가 조용하다는 데 있다. 규칙 없이 생성된 수정안도 문장으로는 멀쩡해 보이므로, 전체 번역은 규칙을 지켜 나왔는데 부분 수정만 규칙 없이 나오면 번역사가 다듬을수록 문서 내 일관성이 무너진다. 부분 수정의 최대 리스크가 바로 불일치인데 방향이 거꾸로였다.

### 수정안

1. `DEFAULT_SELECTION_REFERENCE_OPTIONS`의 `translationRules`/`forbiddenTerms`를 `true`로. `glossary`/`projectContext`는 `false` 유지.
2. 참조 옵션을 `selectionReferenceOptionsRef`로 프로젝트 단위 유지. 프로젝트 전환 시에만 기본값으로 초기화.
3. 선택 채팅에서도 `translationRules`와 금칙어 digest를 주입. 프로젝트 메모리는 `renderChatMemoryDigest({ items: isSelectionRequest ? [] : ... })`로 계속 제외해 `get_project_guidance`에 맡긴다.

### 검증

- `SelectionEditPreviewModal.test.tsx` — 규칙·금칙어 체크박스 ON, 용어집·메모리 OFF로 시작.
- `chatStore.integration.test.ts` — 선택 요청에 `translationRules`/`forbiddenTermsDigest`는 들어가고 `projectMemoryDigest`는 빠지는지.

---

## 작업 순서 (실제 진행 결과)

| 커밋 | 항목 | 비고 |
|------|------|------|
| `e229e9b` | D1 + D2 | `projectMemoryPolicy.ts`/`projectKnowledgeRender.ts` 신설. legacy `projectContext` 슬롯 정리가 겹쳐 함께 처리 |
| `f866564` | D3 | `knowledgeProposals.ts`로 읽기/갱신 일원화 |
| `2638304` | D4 + D5 + D7 | 작고 독립적이라 묶음 |
| `68e9711` | D6 | D1의 정책 모듈을 workflow resolver에 적용 |
| (D9) | D9 | 5번 구조 리뷰에서 추가 발견. 기본값 변경이라 사용자에게 보이는 동작이 바뀜 |

D8-1/D8-2/D8-3은 각 커밋에 테스트로 포함했다(`projectMemoryPolicy.test.ts`, `projectKnowledgeRender.test.ts`, `knowledgeProposals.test.ts`, `ProjectKnowledgeProposalCards.test.tsx`, `chatStore.integration.test.ts`의 D1/D3 케이스).

각 단계 완료 시 `npx tsc --noEmit` + `npm run test:run`으로 검증했다. Rust 변경은 없었다. 전체 완료 후 `npm run test:ci:local`은 위 "검증 메모"의 포트 충돌로 웹 E2E 구간을 실행하지 못했다.

## 완료 후 문서 갱신

- [x] `.claude/CLAUDE.md` "Recent Updates"에 항목 추가
- [x] `docs/INDEX.md` 진행 중인 태스크 표에 이 문서 등록
- [ ] `.claude/patterns.md` — 채팅 컨텍스트 주입 구조(push digest + pull tool) 반영
- [ ] `.claude/gotchas.md` — "메모리 승인은 다음 턴부터 반영" 등 주의사항
- [ ] `docs/selection-editing-and-dynamic-context-plan.md` §14.1에 실제 구현 방식(compact digest) 반영
