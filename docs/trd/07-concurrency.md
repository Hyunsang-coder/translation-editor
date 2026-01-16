# 7. Race Condition 방지 패턴 (Concurrency Safety)

## 7.1 개요

### Why
- 스트리밍 응답 처리, 프로젝트 전환, 채팅 저장 등 비동기 작업이 동시에 발생할 때 데이터 불일치가 발생할 수 있습니다.
- 상태 변경과 비동기 작업 사이의 타이밍 문제를 명시적으로 처리해야 합니다.

### How
- 가드 플래그, 프로젝트 ID 검증, 즉시 상태 정리 등의 패턴을 사용하여 race condition을 방지합니다.

---

## 7.2 chatStore 스트리밍 처리

### `isFinalizingStreaming` 가드 플래그
- 스트리밍 완료 처리 중 새 메시지 전송 방지
- `sendMessage()` 시작 시 finalization 완료 대기 (최대 3초)
- `finalizeStreaming()`에 try-finally 패턴 적용

### 메타데이터 보존
- `finalizeStreaming()`에서 `toolCallsInProgress`만 초기화
- `toolsUsed`/`suggestion` 등 보존

### 에러 복구
- catch 블록에서 `statusMessage`, `isFinalizingStreaming`, `composerAttachments` 완전 정리

---

## 7.3 AbortController 관리

### 즉시 null 설정
- `abort()` 호출 후 즉시 `set({ abortController: null })` 실행

### race window 제거
- 새 controller 생성 전 이전 controller 상태를 완전히 정리

### 패턴
```typescript
const prevAbortController = get().abortController;
if (prevAbortController) {
  prevAbortController.abort();
  set({ abortController: null }); // 즉시 null로 설정
}
```

---

## 7.4 프로젝트 전환 시 채팅 저장

### `scheduledPersistProjectId` 캡처
- 타이머 스케줄 시점의 프로젝트 ID 저장

### persist 전 재검증
- 실행 전 현재 프로젝트 ID와 비교, 다르면 persist 건너뜀

### `hydrateForProject()` 정리
- 타이머 취소 시 캡처된 ID도 함께 정리

### 패턴
```typescript
scheduledPersistProjectId = get().loadedProjectId;
chatPersistTimer = window.setTimeout(() => {
  if (scheduledPersistProjectId !== get().loadedProjectId) {
    return; // 프로젝트 변경됨, persist 건너뜀
  }
  // persist 실행
});
```

---

## 7.5 프로젝트 하이드레이션

### 순차 실행
- `switchProjectById()`에서 `chatStore.hydrateForProject()` 명시적 호출

### 진행 중인 요청 취소
- `hydrateForProject()` 시작 시 기존 `abortController` 취소

### `pendingDocDiff` 즉시 정리
- `switchProjectById()` 시작 시 null로 초기화

---

## 7.6 Cross-Store 상태 구독

### Zustand subscribe 패턴
다른 스토어의 상태 변경 감지

### 예시 (reviewStore → projectStore)
```typescript
useProjectStore.subscribe((state) => {
  if (targetDocJson !== prevTargetDocJson && highlightEnabled) {
    useReviewStore.getState().disableHighlight();
  }
});
```

---

## 7.7 콜백 내 최신 상태 참조

### `getState()` 사용
루프/콜백 내에서 클로저 캡처된 값 대신 최신 상태 참조

### 패턴
```typescript
// 잘못된 방법: 클로저 캡처 (stale 값 참조 가능)
const { translationRules } = useChatStore.getState();
for (const chunk of chunks) {
  await processChunk(chunk, translationRules); // stale
}

// 올바른 방법: 매 청크마다 최신 값 참조
for (const chunk of chunks) {
  const { translationRules } = useChatStore.getState();
  await processChunk(chunk, translationRules); // fresh
}
```
