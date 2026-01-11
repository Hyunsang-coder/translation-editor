# Hybrid Panel Layout: Fixed Sidebar + Floating Chat

## Overview

기존 통합 ChatPanel을 분리하여:
- **Settings/Review**: 고정 사이드바 (탭 전환)
- **Chat**: 플로팅 패널 (드래그/리사이즈 가능)
- **우측 하단**: 플로팅 Chat 버튼

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar                         [ ⚙️ Settings ▼ ]      │
├────────────────────────────┬────────────────────────────┤
│                            │                            │
│        Editor              │     Settings / Review      │
│   (Source + Target)        │       (고정 사이드바)       │
│                            │                            │
│  ┌─ Chat ──────────────┐   │                            │
│  │ [Session1][Session2]│   │                            │
│  │     (플로팅 패널)    │   │                            │
│  └─────────────────────┘   │                     [ 💬 ] │
└────────────────────────────┴────────────────────────────┘
```

## 확정 스펙

| 항목 | 결정 |
|------|------|
| Chat 드래그 | 헤더만, 화면 안에만 |
| Chat 리사이즈 | 8방향, 최소 320×400px |
| Chat 닫기 | X 버튼 + 플로팅 버튼 재클릭 |
| 위치 저장 | uiStore (localStorage persist) |
| 기본 상태 | 사이드바 열림(Settings), Chat 닫힘 |
| 세션 지원 | Chat 패널 내 최대 3개 세션 탭 유지 |

---

## Implementation Progress

| Phase | 항목 | 상태 |
|-------|------|------|
| 1.1 | react-rnd 설치 | DONE |
| 1.2 | uiStore.ts 상태 추가 | DONE |
| 2.1 | SettingsSidebar.tsx 생성 | DONE |
| 2.2 | FloatingChatPanel.tsx 생성 | DONE |
| 2.3 | ChatContent.tsx 생성 | DONE |
| 2.4 | FloatingChatButton.tsx 생성 | DONE |
| 3.1 | Toolbar.tsx 수정 (드롭다운) | DONE |
| 3.2 | MainLayout.tsx 수정 | DONE |
| 3.3 | ChatPanel.tsx 리팩토링 | PENDING (유지, 삭제 미정) |
| 4.1 | AbortController Cleanup | DONE |
| 4.2 | Window Resize Handling | DONE |
| 4.3 | Add to Chat 연동 | DONE |
| 4.4 | 검수 버튼 연동 | DONE (기존 로직 유지) |
| - | i18n 키 추가 | DONE |
| - | 빌드 검증 | DONE |
| - | Settings 사이드바 드래그 리사이즈 | DONE |
| - | 플로팅 버튼 드래그 위치 변경 | DONE |

---

## Phase 1: Dependencies & Store Updates

### 1.1 Install react-rnd
```bash
npm install react-rnd
```

### 1.2 Update uiStore.ts

**추가할 상태:**
```typescript
// Sidebar tab state
sidebarActiveTab: 'settings' | 'review';

// Floating Chat Panel state
chatPanelOpen: boolean;
chatPanelPosition: { x: number; y: number };
chatPanelSize: { width: number; height: number };
```

**기본값:**
```typescript
sidebarActiveTab: 'settings',
chatPanelOpen: false,
// 주의: window 객체는 초기화 시점에 없을 수 있으므로 함수로 계산
chatPanelPosition: { x: 0, y: 100 },  // 실제 위치는 컴포넌트에서 계산
chatPanelSize: { width: 420, height: 600 },
```

**persist에 추가:**
```typescript
sidebarActiveTab, chatPanelOpen, chatPanelPosition, chatPanelSize
```

**주의사항:**
- `chatPanelPosition`의 기본 x값은 컴포넌트 마운트 시 `window.innerWidth - 440`으로 계산
- persist에서 로드된 값이 없을 때만 기본값 적용
- 기존 `sidebarCollapsed`는 Settings/Review 사이드바용으로 유지

---

## Phase 2: Create New Components

### 2.1 SettingsSidebar.tsx (NEW)
`src/components/panels/SettingsSidebar.tsx`

- ChatPanel에서 Settings/Review 부분 추출
- 탭 헤더: Settings | Review (reviewPanelOpen일 때만 Review 표시)
- Settings 내용: Persona, Rules, Context, Glossary, Attachments
- Review 내용: 기존 ReviewPanel 컴포넌트

### 2.2 FloatingChatPanel.tsx (NEW)
`src/components/panels/FloatingChatPanel.tsx`

- react-rnd 래퍼
- 드래그 핸들: 상단 헤더 (10px)
- 닫기 버튼: 헤더 우측 X
- 내용: ChatContent 컴포넌트

```typescript
<Rnd
  position={chatPanelPosition}
  size={chatPanelSize}
  minWidth={320}
  minHeight={400}
  bounds="window"
  dragHandleClassName="floating-chat-handle"
>
  <ChatHeader onClose={toggleChatPanel} />
  <ChatContent />
</Rnd>
```

### 2.3 ChatContent.tsx (NEW)
`src/components/chat/ChatContent.tsx`

ChatPanel에서 채팅 기능 추출:
- 세션 탭 (최대 3개)
- 메시지 리스트
- 스트리밍 스켈레톤
- Composer (입력창 + 첨부 + 토글들)

### 2.4 FloatingChatButton.tsx (NEW)
`src/components/ui/FloatingChatButton.tsx`

```typescript
<button
  onClick={toggleChatPanel}
  className="fixed bottom-6 right-6 z-[9999] w-14 h-14 rounded-full bg-primary-500"
>
  {chatPanelOpen ? '✕' : '💬'}
</button>
```

---

## Phase 3: Modify Existing Components

### 3.1 Toolbar.tsx
- 기존 💬 버튼 제거
- Settings 드롭다운 버튼 추가:
  ```
  [ ⚙️ Settings ▼ ]
       ├── Project Settings → 사이드바 열기 + Settings 탭
       └── Review → openReviewPanel()
  ```

### 3.2 MainLayout.tsx
- ChatPanel → SettingsSidebar로 교체
- isPanelsSwapped 로직 제거 (Chat이 플로팅이므로 불필요)
- PanelGroup 외부에 플로팅 컴포넌트 렌더링:
  ```typescript
  <FloatingChatPanel />
  <FloatingChatButton />
  ```

### 3.3 ChatPanel.tsx
- 리팩토링 후 삭제 또는 최소화
- 내용은 SettingsSidebar, ChatContent로 분리됨

---

## Phase 4: Edge Cases & Cleanup

### 4.1 AbortController Cleanup
Chat 패널 닫을 때 진행 중인 AI 요청 취소:
```typescript
useEffect(() => {
  return () => {
    useChatStore.getState().abortController?.abort();
  };
}, []);
```

### 4.2 Window Resize Handling
화면 크기 변경 시 패널이 경계 밖으로 나가지 않도록:
```typescript
useEffect(() => {
  const handleResize = () => {
    // 패널 위치를 화면 안으로 조정
  };
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

### 4.3 Add to Chat 연동
에디터에서 "Add to Chat" 클릭 시:
- Chat 패널 자동 열림 (`setChatPanelOpen(true)`)
- Composer에 텍스트 추가

**수정 필요 파일:**
- `DomSelectionAddToChat.tsx`: `sidebarCollapsed` → `chatPanelOpen` 변경
- `EditorCanvasTipTap.tsx`: Add to Chat 로직 수정
- `TipTapEditor.tsx`: Add to Chat 로직 수정

```typescript
// 기존
if (ui.sidebarCollapsed) ui.toggleSidebar();
ui.setActivePanel('chat');

// 변경
ui.setChatPanelOpen(true);
```

### 4.4 검수 버튼 연동
에디터에서 "검수" 버튼 클릭 시:
- 사이드바 열림 + Review 탭 활성화 (기존 동작 유지)

---

## File Changes Summary

| 파일 | 작업 |
|------|------|
| `package.json` | react-rnd 추가 |
| `src/stores/uiStore.ts` | 패널 상태 추가 |
| `src/components/panels/SettingsSidebar.tsx` | **NEW** |
| `src/components/panels/FloatingChatPanel.tsx` | **NEW** |
| `src/components/chat/ChatContent.tsx` | **NEW** |
| `src/components/ui/FloatingChatButton.tsx` | **NEW** |
| `src/components/layout/Toolbar.tsx` | 드롭다운 버튼 |
| `src/components/layout/MainLayout.tsx` | 레이아웃 변경 |
| `src/components/panels/ChatPanel.tsx` | 분리 후 삭제/최소화 |
| `src/components/editor/DomSelectionAddToChat.tsx` | Chat 패널 열기 로직 수정 |
| `src/components/editor/EditorCanvasTipTap.tsx` | Add to Chat 로직 수정 |
| `src/components/editor/TipTapEditor.tsx` | Add to Chat 로직 수정 |
| `src/i18n/locales/ko.json` | 번역 키 추가 |
| `src/i18n/locales/en.json` | 번역 키 추가 |

---

## Verification

### 테스트 체크리스트

1. **사이드바**
   - [ ] Settings 탭에서 모든 섹션 표시
   - [ ] Review 탭 열기/닫기
   - [ ] 탭 상태 유지 (새로고침 후)

2. **플로팅 Chat 패널**
   - [ ] 플로팅 버튼으로 열기/닫기
   - [ ] 헤더로 드래그 이동
   - [ ] 8방향 리사이즈
   - [ ] 위치/크기 유지 (새로고침 후)
   - [ ] 화면 밖으로 나가지 않음

3. **Chat 기능**
   - [ ] 세션 탭 전환 (최대 3개)
   - [ ] 메시지 전송/수신
   - [ ] 스트리밍 동작
   - [ ] Composer 첨부파일
   - [ ] 웹검색/Confluence/Notion 토글

4. **통합**
   - [ ] Add to Chat → Chat 패널 열림
   - [ ] 검수 버튼 → Review 탭 열림
   - [ ] 기본 상태: 사이드바 열림, Chat 닫힘
