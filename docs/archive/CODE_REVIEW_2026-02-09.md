# Code Review Report - OddEyes.ai Translation Editor

**Date**: 2026-02-09
**Reviewer**: Claude Opus 4.6 (Automated Review)
**Branch**: main
**Version**: 1.6.2
**Scope**: Full codebase (TypeScript 126 files, Rust 34 files)

---

## Executive Summary

| Category | Status | Notes |
|----------|--------|-------|
| **Overall Health** | ✅ Good | 견고한 아키텍처, 도메인 분리 잘 됨 |
| **Security** | ✅ Strong | SQL 인젝션 없음, 시크릿 암호화, XSS 방어 |
| **Performance** | ⚠️ Medium | 스토어 셀렉터 누락, 에디터 플러그인 이중 연산 |
| **Code Quality** | ⚠️ Medium | 주요 파일 코드 중복, 대형 스토어 분리 필요 |
| **Memory** | ✅ Good | 타이머/AbortController 정리 양호 |
| **Accessibility** | ❌ Needs Work | Error Boundary 없음, 모달 포커스 트랩 없음 |

**Overall Grade**: **B+**

---

## 코드 통계

| Metric | Count |
|--------|-------|
| TypeScript/TSX Files | 126 |
| Rust Files | 34 |
| Test Files | 16 |
| TypeScript LOC | ~33,271 |
| Rust LOC | ~7,997 |
| Largest TS File | chatStore.ts (1,766 lines) |
| Largest Rust File | db/mod.rs (1,132 lines) |

---

## Issues Found

### CRITICAL (즉시 수정)

#### CR-01. DiffMark acceptDiff/rejectDiff Position Shift 버그

**File**: `src/editor/extensions/DiffMark.ts:149-188`

`doc.descendants()`로 순회하면서 `tr.delete()`를 실행하면, 첫 삭제 이후 모든 position이 shift되어 이후 삭제가 잘못된 위치를 대상으로 합니다.

```typescript
// BUG: pos는 원본 문서 기준이나, 이전 delete로 인해 실제 위치가 변경됨
doc.descendants((node, pos) => {
  if (node.marks.some((mark) => mark.type.name === 'deletion')) {
    tr.delete(pos, pos + node.nodeSize); // 두 번째 이후 삭제는 잘못된 위치
  }
});
```

**Impact**: 문서 손상, RangeError 예외 발생 가능
**Fix**: position 수집 후 역순(뒤→앞) 삭제 또는 `tr.mapping.map(pos)` 사용

---

#### CR-02. Rust `split_block` UTF-8 바이트 경계 패닉

**File**: `src-tauri/src/commands/block.rs:69-77`

```rust
let first_part = if split_position < original_content.len() {
    original_content[..split_position].to_string() // PANIC if not char boundary
} else {
    original_content.clone()
};
```

프론트엔드에서 전달되는 `split_position`이 멀티바이트 문자(한/중/일) 중간에 위치하면 `byte index is not a char boundary` 패닉으로 앱 전체가 크래시됩니다.

**Impact**: 앱 크래시 (DoS)
**Fix**: `original_content.is_char_boundary(split_position)` 검증 추가

---

### HIGH (조기 수정 권장)

#### HI-01. chatStore sendMessage/replayMessage ~80% 코드 중복

**File**: `src/stores/chatStore.ts:622-1021, 1182-1463`

두 메서드가 ~500줄을 공유합니다:
- 컨텍스트 블록 해석, ghost chip 마스킹, 용어집 검색
- 스트리밍 콜백 (`onToken`, `onToolCall`, `onToolsUsed`)
- 에러 핸들링, 스트리밍 종료 처리

버그 수정/기능 변경 시 두 곳을 동시에 수정해야 하는 높은 유지보수 부담.

**Fix**: 공통 로직을 `executeAIChat()` 같은 내부 헬퍼로 추출

---

#### HI-02. chat.ts generateAssistantReply/streamAssistantReply 중복

**File**: `src/ai/chat.ts:859-957, 962-1072`

메시지 빌딩, 툴 스펙 구성, 가이드 메시지 생성, 이미지 핸들링 코드 ~200줄이 거의 동일하게 중복.

**Fix**: 공통 메시지 빌더 함수 추출

---

#### HI-03. translateDocument.ts 스트리밍/비스트리밍 프롬프트 중복

**File**: `src/ai/translateDocument.ts:106-308, 350-578`

시스템 프롬프트 구성 (~80줄), 토큰 계산 (~20줄), 후처리 로직 (~20줄) 중복.

**Fix**: `buildTranslationPrompt()` 공통 함수 추출

---

#### HI-04. useProjectStore()/useUIStore() 셀렉터 없이 호출

**Affected files**:
- `App.tsx:14-15` - 루트 컴포넌트에서 전체 스토어 구독
- `SegmentGroupRow.tsx:20`
- `SourcePanel.tsx:9`, `TargetPanel.tsx:9`
- `MainLayout.tsx:24`, `Toolbar.tsx:13-14`
- `AppSettingsModal.tsx:20`, `SettingsSidebar.tsx:20`

```typescript
// BAD - 전체 스토어 구독, 모든 상태 변경 시 리렌더
const { initializeProject, startAutoSave, stopAutoSave } = useProjectStore();

// GOOD - 필요한 값만 구독
const initializeProject = useProjectStore((s) => s.initializeProject);
```

**Impact**: 루트 컴포넌트 포함 불필요한 리렌더 다수 발생
**Fix**: 개별 셀렉터 또는 `useShallow` 그룹 셀렉터 적용

---

#### HI-05. chatStore.ts 1,767줄 - 7개 관심사 혼재

`chatStore.ts`가 관리하는 관심사:
1. 세션 관리
2. 메시지 CRUD
3. 스트리밍 상태
4. 컴포저 상태
5. 영속성 (SQLite)
6. 첨부파일
7. AI 상호작용

**Fix**: 비즈니스 로직을 서비스 함수로 추출, 또는 Zustand slice 패턴 적용

---

#### HI-06. React Error Boundary 없음

전체 컴포넌트 트리에 Error Boundary가 존재하지 않습니다. TipTap 확장, 마크다운 파서, AI 응답 렌더링 등에서 렌더링 에러가 발생하면 **앱 전체가 크래시**됩니다.

**Fix**: 에디터, 채팅, 리뷰 패널 각각에 Error Boundary 래핑

---

#### HI-07. setContent()가 Undo 히스토리 파괴

**File**: `src/hooks/useBlockEditor.ts:155-157`, `src/components/editor/TipTapEditor.tsx:169-176, 353-360`

```typescript
editor.commands.setContent(content); // Undo 히스토리 전체 초기화
```

외부 콘텐츠 동기화 시 `setContent`를 호출하면 사용자의 Undo/Redo 스택이 사라집니다. 번역 적용 후에도 동일하게 히스토리가 파괴됩니다.

---

#### HI-08. TipTapEditor double-destroy 문제

**File**: `src/components/editor/TipTapEditor.tsx:193-199, 377-383`

```typescript
useEffect(() => {
  return () => {
    if (editor) editor.destroy();
  };
}, [editor]); // useEditor가 이미 destroy 처리 → 이중 destroy
```

TipTap의 `useEditor` 훅이 자체적으로 destroy를 처리하므로, 수동 destroy가 이중 실행됩니다.

---

### MEDIUM (계획적 수정)

#### MD-01. 프롬프트 인젝션 방어 미비 - MCP 도구

**File**: `src/ai/chat.ts:290`

외부 콘텐츠 래핑 목록이 4개 도구에 하드코딩:
```typescript
const EXTERNAL_TOOLS = ['notion_get_page', 'getConfluencePage', 'notion_search', 'notion_query_database'];
```

동적 로드되는 MCP 도구의 출력은 `<external_content>` 래핑이 적용되지 않음.

**Fix**: MCP 도구 출력을 자동으로 래핑하도록 수정

---

#### MD-02. translatorPersona 미검증 시스템 프롬프트 삽입

**File**: `src/ai/prompt.ts:127-129`, `src/ai/translateDocument.ts:150-152, 381-383`

사용자 제공 페르소나 문자열이 시스템 프롬프트에 직접 삽입되어 프롬프트 인젝션 가능성 존재.

---

#### MD-03. pendingDiffs 직접 mutation

**File**: `src/stores/projectStore.ts:1372, 1385`

```typescript
const pendingDiffs = get().pendingDiffs;
delete pendingDiffs[blockId]; // 현재 스토어 상태 객체를 직접 변이
set({ pendingDiffs: { ...pendingDiffs } }); // spread는 이후에 발생
```

**Fix**: `const { [blockId]: _, ...rest } = pendingDiffs;` 패턴 사용

---

#### MD-04. save_temp_image 파일명 경로 탐색

**File**: `src-tauri/src/commands/attachments.rs:329-377`

프론트엔드 전달 `filename`에 `../../` 등 디렉터리 탐색 문자가 포함될 수 있음. UUID 프리픽스와 결합 후 OS가 경로를 정규화하여 의도치 않은 위치에 파일 작성 가능.

**Fix**: filename에서 path separator 제거 또는 `Path::file_name()` 사용

---

#### MD-05. SearchHighlight/ReviewHighlight 이중 문서 순회

**File**: `src/editor/extensions/SearchHighlight.ts:53-67`, `ReviewHighlight.ts:25-39`

동일한 `buildTextWithPositions` 함수가 두 파일에 중복. 매 키입력마다 두 플러그인이 각각 전체 문서를 O(n) 순회하여 문자 단위 position 매핑 배열을 생성합니다.

**Fix**: 공통 함수 추출, 캐싱 도입 검토

---

#### MD-06. SearchHighlight replaceMatch 시 매치 3중 계산

**File**: `src/editor/extensions/SearchHighlight.ts:391-456, 520-531`

교체 실행 시:
1. plugin `apply`에서 `docChanged` → 매치 재계산
2. `queueMicrotask` → 매치 재계산 후 dispatch
3. 두 번째 dispatch의 `apply` → 또 재계산

**Fix**: `queueMicrotask` 제거, plugin `apply`의 결과 활용

---

#### MD-07. 매직 넘버 산재

토큰 제한/컨텍스트 윈도우 크기가 여러 파일에 하드코딩:
- `client.ts:31-34`: 8192, 4096
- `translateDocument.ts:204`: 200_000, 400_000
- `translateDocument.ts:214`: 64000, 65536, 16384
- `translateDocument.ts:467-478`: 반복

**Fix**: `src/ai/constants.ts`에 상수 집중화

---

#### MD-08. `as any` 타입 캐스트 과다

- `chat.ts`: 11곳 (lines 58, 62, 80, 87, 95, 193, 250, 340, 364, 928, 945)
- `translateDocument.ts`: 5곳 (lines 641, 644, 656, 664, 679)

TypeScript 타입 안전성을 무력화합니다.

---

#### MD-09. initializeProject 미추적 async IIFE

**File**: `src/stores/projectStore.ts:346-416`

```typescript
void (async () => {
  // 에러가 silent swallow됨
  // 호출자가 완료/실패를 알 수 없음
})();
```

**Fix**: async 함수를 직접 반환하거나, 에러를 스토어 상태에 반영

---

#### MD-10. uiStore persist에 version/migrate 없음

**File**: `src/stores/uiStore.ts:382-411`

`aiConfigStore`는 `version: 6`과 `migrate` 함수가 있으나, `uiStore`는 버전 관리 없이 18개 필드를 영속화. 스키마 변경 시 기존 데이터와 충돌 가능.

---

#### MD-11. getHTML() 비교의 비신뢰성

**File**: `src/hooks/useBlockEditor.ts:155`, `src/components/editor/TipTapEditor.tsx:169, 353`

```typescript
if (editor && editor.getHTML() !== content) {
  editor.commands.setContent(content);
}
```

TipTap의 HTML 직렬화는 속성 순서, 공백, self-closing 태그 등에서 입력 HTML과 다를 수 있어 동일 콘텐츠를 다르다고 판단하거나, 다른 콘텐츠를 같다고 판단할 수 있음.

---

#### MD-12. ReviewHighlight가 ProseMirror apply 내에서 Zustand 호출

**File**: `src/editor/extensions/ReviewHighlight.ts:198-199`

매 트랜잭션(커서 이동 포함)마다 `useReviewStore.getState()`를 호출하고, `docChanged` 시 전체 문서 순회.

---

#### MD-13. SourceTipTapEditor/TargetTipTapEditor ~90% 코드 중복

**File**: `src/components/editor/TipTapEditor.tsx:37-210, 216-395`

차이점은 Cmd+H 단축키, placeholder 텍스트, ReviewHighlight의 excerptField 뿐.

**Fix**: `panelType` prop으로 단일 컴포넌트 통합

---

### LOW (개선 권장)

#### LO-01. 접근성(a11y) 미비 - 모달 포커스 트랩 없음

**Affected files**:
- `TranslatePreviewModal.tsx`
- `ReviewModal.tsx`
- `AppSettingsModal.tsx`
- `ConnectorsSection.tsx` (NotionTokenDialog)
- `ReviewPanel.tsx` (retranslate modal)

모든 모달에 `role="dialog"`, `aria-modal="true"`, 포커스 트래핑, ESC 키 닫기 처리 없음.

---

#### LO-02. 접근성(a11y) 미비 - 탭/인터랙티브 요소

**File**: `src/components/chat/ChatContent.tsx:463-497`, `SettingsSidebar.tsx:335-362`

세션 탭이 `<div onClick>` - `role="tab"`, `tabIndex`, `aria-selected`, 키보드 내비게이션 없음.

---

#### LO-03. Confluence pageCache 무한 증가

**File**: `src/ai/tools/confluenceTools.ts:162`

Map에 크기 제한 없이 페이지 콘텐츠 캐싱. TTL 만료는 접근 시에만 동작.

**Fix**: LRU 캐시 또는 최대 크기 제한 추가

---

#### LO-04. MCP 에러 타입 소실

**File**: `src/ai/mcp/McpClientManager.ts:84`

```typescript
throw new Error(`MCP tool call failed: ${error}`);
// Error 객체가 "[object Object]"로 변환됨
```

**Fix**: `throw new Error('...', { cause: error })` 사용

---

#### LO-05. Rust 커맨드 에러 타입 불일치

MCP/Confluence/Connector/Notion 커맨드는 `Result<T, String>`, 나머지는 `CommandResult<T>`.

**Fix**: 모든 커맨드를 `CommandResult<T>`로 통일

---

#### LO-06. truncateToolOutput 함수 중복

**File**: `src/ai/mcp/McpClientManager.ts:12-20`, `src/ai/tools/notionTools.ts:15-23`

동일 함수가 두 파일에 존재.

**Fix**: `src/ai/utils.ts`로 추출

---

#### LO-07. Rust lock 보일러플레이트 ~20회 반복

```rust
let db = db_state.0.lock().map_err(|e| CommandError {
    code: "LOCK_ERROR".to_string(),
    message: format!("Failed to acquire database lock: {}", e),
    details: None,
})?;
```

**Fix**: `fn acquire_db(state: &DbState) -> CommandResult<MutexGuard<Database>>` 헬퍼 추출

---

#### LO-08. history.rs 미구현 스텁

**File**: `src-tauri/src/commands/history.rs`

`create_snapshot`, `restore_snapshot`, `list_history`가 TODO 상태로 Tauri 커맨드에 등록됨.

---

#### LO-09. Rust println! 로깅

`oauth.rs`에 25개+ `println!`/`eprintln!`. 토큰 길이, OAuth 클라이언트 ID 등 민감 정보 출력 가능.

**Fix**: `tracing` 또는 `log` 크레이트 도입

---

#### LO-10. TranslationBlock split 시 duplicate blockId

**File**: `src/editor/extensions/TranslationBlock.ts:91-114`

`tr.split(pos)` 호출 시 새 블록에 새 `blockId`가 할당되지 않아 중복 ID 발생.

---

#### LO-11. setTimeout/clearTimeout 미정리

**File**: `src/components/chat/ChatContent.tsx:377, 405`

`setTimeout` 호출 후 컴포넌트 언마운트 시 `clearTimeout` 없음.

---

#### LO-12. VisualDiffViewer 배열 인덱스 key 사용

**File**: `src/components/ui/VisualDiffViewer.tsx:122-123`

diff 행이 변경/재정렬될 수 있어 인덱스 key 사용 시 잘못된 DOM 재활용 가능.

---

#### LO-13. ReviewPanel getAllIssues()/getCheckedIssues() 매 렌더 호출

**File**: `src/components/review/ReviewPanel.tsx:432-433`

`useMemo` 없이 렌더 본문에서 직접 호출.

**Fix**: `useMemo(() => getAllIssues(), [results])` 적용

---

#### LO-14. ChatContent 816줄 모놀리식 컴포넌트

세션 탭, 메시지 목록, 드래그앤드롭, 페이스트, 첨부파일, 컴포저, 모델 선택, 검색 토글을 모두 포함.

**Fix**: `SessionTabBar`, `ComposerForm`, `MessageList` 등으로 분리

---

#### LO-15. buildAlignedChunks 리뷰 도구 흐름에서 2회 호출

**File**: `src/ai/tools/reviewTool.ts:341, 443`

`reviewTranslationTool`과 `getReviewChunkTool`이 각각 독립적으로 `buildAlignedChunks(project)` 호출. 캐싱 없음.

---

#### LO-16. Partial response 표시 없이 반환

**File**: `src/ai/chat.ts:400-404`

스트림 에러 발생 시 이미 누적된 partial text가 완전한 응답인 것처럼 반환됨.

---

#### LO-17. Verbose console.log in production

**File**: `src/editor/extensions/ReviewHighlight.ts:61-66, 73, 80-84, 91-94, 152-159`

리뷰 이슈당 1개씩 로그 출력. 이슈 50개면 매 문서 변경마다 50줄 로그.

**Fix**: debug 플래그 가드 또는 제거

---

## 잘된 부분 (Strengths)

### Security
- **SQL 인젝션 제로**: 모든 쿼리가 매개변수화 (`?1`, `?2`)
- **시크릿 암호화**: XChaCha20-Poly1305 vault + OS keychain
- **API 키 localStorage 제외**: `partialize`로 민감 필드 영속화 방지, `merge`로 rehydration 시 초기화
- **XSS 방어**: `dangerouslySetInnerHTML` 사용처에 DOMPurify 적용, ReactMarkdown `skipHtml`
- **에러 로그 민감정보 제거**: `notionTools.ts`에서 토큰/키/시크릿 정규식 삭제

### Architecture
- **On-demand 문서 가져오기**: 채팅 시 문서를 초기 페이로드에 포함하지 않고 Tool call로 필요 시 가져옴
- **Translator-led workflow**: AI 자동 적용 없이 항상 Preview → 사용자 확인 → Apply
- **2-Pass Review**: 과다 탐지 후 false positive 필터링하는 정교한 검수 시스템
- **도메인 분리된 Zustand 스토어**: chat, project, ui, aiConfig, connector, review

### Rust Backend
- **unsafe 코드 없음**: 전체 코드베이스에 unsafe 블록 부재
- **적절한 에러 핸들링**: `?` 연산자, `map_err()` 일관 사용, 사용자 데이터에 `unwrap()` 없음
- **시크릿 메모리 관리**: MasterKey Drop 시 zeroize, vault 복호화 평문 zeroize
- **WAL 모드 + Foreign Keys**: SQLite 동시 접근 성능 + 데이터 무결성

### Frontend
- **크로스 스토어 접근**: `getState()` 사용으로 순환 구독 방지
- **AbortController 수명 관리**: 이전 컨트롤러 abort 후 새로 생성, 에러 경로에서 정리
- **chatStore.selectors.ts**: `useShallow` 기반 그룹 셀렉터로 리렌더 최적화
- **커스텀 영속성**: chatStore는 프로젝트별 SQLite 저장, 디바운스 + 동시 요청 처리

### AI Integration
- **재시도 로직**: 지수 백오프 + 지터, 레이트 리밋/서버 에러/타임아웃 처리
- **동일 에러 루프 감지**: `MAX_SAME_ERROR = 2`로 같은 도구 반복 호출 방지
- **도구 타임아웃**: 개별 도구 호출에 30초 타임아웃 적용
- **토큰 제한 강제**: 컨텍스트 유형별 문자 수 제한, 첨부파일 총량 제한

### Testing
- **핵심 유틸 테스트**: parseReviewResult, markdownConverter, wordCounter, adfParser, normalizeForSearch 등 커버리지 양호
- **Rust vault 테스트**: 암복호화 라운드트립, 잘못된 키 검증

---

## 수정 우선순위

### Phase 1 - 즉시 (Critical 버그)
1. CR-01: DiffMark position shift 버그 수정
2. CR-02: Rust split_block UTF-8 경계 검증 추가

### Phase 2 - 단기 (렌더링 성능 + 안정성)
3. HI-04: 셀렉터 없는 스토어 구독 수정
4. HI-06: Error Boundary 추가
5. HI-07: setContent undo 히스토리 보존 검토
6. HI-08: TipTapEditor double-destroy 제거

### Phase 3 - 중기 (코드 중복 제거)
7. HI-01: chatStore sendMessage/replayMessage 통합
8. HI-02: chat.ts generate/stream 통합
9. HI-03: translateDocument.ts 프롬프트 통합
10. MD-13: TipTapEditor Source/Target 통합
11. HI-05: chatStore 관심사 분리

### Phase 4 - 장기 (보안 + 품질)
12. MD-01: MCP 도구 출력 자동 래핑
13. MD-07: 매직 넘버 상수 집중화
14. MD-08: `as any` 제거 및 타입 정의
15. LO-01~02: a11y 개선 (모달 포커스 트랩, ARIA 역할)
16. LO-09: Rust 구조화 로깅 도입
17. MD-05~06: 에디터 플러그인 성능 최적화

---

## Previous Review Comparison

### 2026-01-21 v2 리뷰 대비 변경사항

| 이전 이슈 | 상태 | 비고 |
|----------|------|------|
| Select.tsx setTimeout 미정리 | ✅ 확인 필요 | 이번 리뷰 범위 외 |
| XSS 방어 | ✅ 유지됨 | DOMPurify + skipHtml 적용 |
| Path Traversal 방어 | ⚠️ 개선 필요 | save_temp_image 파일명 검증 미비 |
| 메모리 누수 | ✅ 양호 | AbortController/타이머 정리 잘 됨 |

### 신규 발견 이슈
- DiffMark position shift 버그 (Critical)
- UTF-8 바이트 경계 패닉 (Critical)
- 대규모 코드 중복 (chat.ts, translateDocument.ts, chatStore.ts)
- Error Boundary 부재
- setContent undo 히스토리 파괴
- a11y 전반적 미비

---

*Generated by Claude Opus 4.6 - Full codebase review (6 parallel agents)*
