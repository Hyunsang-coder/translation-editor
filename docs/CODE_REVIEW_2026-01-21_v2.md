# Code Review Report - OddEyes.ai Translation Editor

**Date**: 2026-01-21
**Reviewer**: Claude (Automated Review)
**Branch**: beta-1.0
**Commit Range**: 3bfc00e ~ 46e77b9

---

## Executive Summary

| Category | Status | Notes |
|----------|--------|-------|
| **Overall Health** | ✅ Good | 최근 주요 이슈 해결됨 |
| **Security** | ✅ Strong | XSS, Path Traversal 방어 완비 |
| **Performance** | ⚠️ Medium | 최적화 진행 중, 일부 개선 필요 |
| **Memory** | ✅ Good | 최근 메모리 누수 수정됨 |

**Overall Grade**: **A-**

---

## Issues Found

### HIGH Priority

#### 1. Select Component - setTimeout 미정리
**File**: `src/components/ui/Select.tsx:111`

```typescript
// 현재 코드
setTimeout(() => setIsOpen(open), 0);
```

**문제**: 렌더링마다 생성되는 setTimeout이 정리되지 않음. 컴포넌트 언마운트 시 경고 발생 가능.

**수정안**: useEffect로 이동
```typescript
useEffect(() => {
  if (open !== isOpen) {
    setIsOpen(open);
  }
}, [open, isOpen]);
```

---

#### 2. FloatingChatButton - 전역 이벤트 리스너 최적화
**File**: `src/components/ui/FloatingChatButton.tsx:37-42`

**문제**: `mousemove` 리스너가 채팅 패널 열림 상태에서도 계속 활성화됨.

**수정안**: 버튼이 보일 때만 리스너 등록
```typescript
useEffect(() => {
  if (chatPanelOpen) return; // 버튼이 숨겨진 경우 스킵

  const handleMouseMove = () => { mouseMoveCountRef.current += 1; };
  document.addEventListener('mousemove', handleMouseMove);
  return () => document.removeEventListener('mousemove', handleMouseMove);
}, [chatPanelOpen]);
```

---

#### 3. ReviewPanel - 프로젝트 ID 검증 누락
**File**: `src/components/review/ReviewPanel.tsx:153`

**문제**: `buildAlignedChunksAsync` 완료 후 현재 프로젝트 검증 없음. 비동기 작업 중 프로젝트 전환 시 잘못된 데이터 처리 가능.

**수정안**:
```typescript
const freshChunks = await buildAlignedChunksAsync(project);
const currentProject = useProjectStore.getState().project;
if (currentProject?.id !== project.id) {
  console.warn('Project changed during chunk building, aborting review');
  return;
}
```

---

### MEDIUM Priority

#### 4. ProjectStore - 빠른 프로젝트 전환 시 Race Condition
**File**: `src/stores/projectStore.ts:208-211`

**문제**: 500ms 내 프로젝트 A→B→C 전환 시, A의 저장이 C에 덮어쓸 가능성.

**권장**: 모든 pending write에 project ID 포함 및 검증.

---

#### 5. Select Component - Resize 이벤트 디바운싱 필요
**File**: `src/components/ui/Select.tsx:62-66`

**문제**: 드롭다운 열릴 때마다 `getBoundingClientRect()` 호출. 복잡한 페이지에서 리플로우 유발.

**권장**: resize 이벤트에 debounce 적용.

---

### LOW Priority

#### 6. App.tsx - 초기화 실패 시 UI 피드백 없음
**File**: `src/App.tsx:36-51`

**문제**: Secrets 초기화 실패 시 콘솔 로그만 출력. 사용자에게 알림 없음.

**권장**: UI 스토어에 에러 상태 설정하여 경고 배너 표시.

---

## Recently Fixed (Verified ✅)

| Issue | File | Commit |
|-------|------|--------|
| TipTap destroy() 미호출 | TipTapEditor.tsx | 3bfc00e |
| TranslatePreviewModal cleanup | TranslatePreviewModal.tsx | 3bfc00e |
| Editor Registry cleanup | editorRegistry.ts | 3bfc00e |
| 메시지 FIFO 제한 (1000개) | chatStore.ts | 3bfc00e |
| Auto-save 타이머 cleanup | projectStore.ts | 3bfc00e |
| 콘솔 로깅 DEV guard | McpClientManager.ts | 3bfc00e |
| 임시 이미지 cleanup (Rust) | lib.rs | 3bfc00e |
| buildAlignedChunks 비동기화 | reviewTool.ts | 6b241c9 |
| Zustand 그룹 셀렉터 | chatStore.selectors.ts | 6b241c9 |
| GlobalThis 참조 오류 | test/setup.ts | 46e77b9 |

---

## Security Status ✅

| Area | Implementation | Status |
|------|----------------|--------|
| XSS Prevention | DOMPurify + URL protocol validation | ✅ |
| Path Traversal | Rust `validate_path()` | ✅ |
| API Key Storage | OS Keychain | ✅ |
| Input Limits | Translation Rules 10K, Context 30K | ✅ |

---

## Action Items

### Immediate (This Sprint)
- [ ] Issue #1: Select setTimeout → useEffect
- [ ] Issue #2: FloatingChatButton 리스너 조건부 등록
- [ ] Issue #3: ReviewPanel 프로젝트 ID 검증

### Near-term (1-2 Sprints)
- [ ] Issue #4: 프로젝트 전환 persistence 강화
- [ ] Issue #5: Select resize 디바운싱
- [ ] Issue #6: 초기화 실패 UI 피드백

---

## Conclusion

코드베이스 전반적으로 양호한 상태. 최근 커밋(3bfc00e, 6b241c9)에서 주요 메모리 누수와 성능 이슈가 해결됨. 남은 이슈들은 엣지 케이스이며 우선순위에 따라 순차적으로 해결 권장.
