---
paths: ["src/stores/**/*"]
alwaysApply: false
---

# Store Rules

Zustand 상태 관리 작업 시 적용되는 규칙.

## Critical Checklist

- [ ] `isFinalizingStreaming` 가드 플래그로 race condition 방지
- [ ] `abortController.abort()` 후 즉시 `null` 설정
- [ ] 프로젝트 전환 시 `scheduledPersistProjectId` 검증
- [ ] Cross-store 접근 시 `getState()` 사용 (selector로 구독 아님)
- [ ] 콜백 내 최신 상태는 매번 `getState()` 호출

## Store Hierarchy

```
projectStore → SQLite (.ite)
chatStore → SQLite (chat_sessions, chat_messages)
aiConfigStore → localStorage
connectorStore → localStorage (토큰은 SecretManager)
uiStore → localStorage
reviewStore → 메모리만 (비영속)
```

## Race Condition Patterns

### 1. Streaming Finalization Guard
```typescript
if (isFinalizingStreaming) {
  await waitForFinalization();
}
```

### 2. AbortController Cleanup
```typescript
prevController.abort();
set({ abortController: null });  // 즉시 null
const newController = new AbortController();
```

### 3. Fresh State in Callbacks
```typescript
// Bad: closure capture
const { rules } = getState();
for (const chunk of chunks) { ... }

// Good: fresh state
for (const chunk of chunks) {
  const { rules } = getState();
  ...
}
```

## Cross-Store Subscription

```typescript
// reviewStore → projectStore 구독
useProjectStore.subscribe((state) => {
  if (state.targetDocJson !== prev && !isApplyingSuggestion) {
    disableHighlight();
  }
});
```

## Common Pitfalls

1. **Hydration Mismatch**: `skipHydration` 옵션 사용
2. **순환 참조**: `getState()` 사용, subscribe 패턴
3. **불필요한 리렌더링**: selector 함수로 필요한 값만 구독
4. **프로젝트 전환 시 채팅 혼합**: persist 전 projectId 검증
