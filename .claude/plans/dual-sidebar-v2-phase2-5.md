# Dual Sidebar v2: Phase 2-5 구현 (Phase 1 완료)

## 완료된 작업 (Phase 1)

Phase 1에서 타입과 스토어를 도킹 모델로 전환 완료:

- **`src/types/index.ts`**: `SidebarState` → `DockingSidebarState` (panels[], activePanel), `PanelType` 추가, `PanelDragData` 추가, `SidebarTab`은 deprecated alias로 유지
- **`src/stores/uiStore.ts`**:
  - State: `leftSidebar`/`rightSidebar`가 `DockingSidebarState` 타입
  - 기본값: left=`{panels:['settings','review'], activePanel:'settings'}`, right=`{panels:['chat'], activePanel:'chat'}`
  - 신규 액션: `setActivePanel_side`, `openPanel`, `openPanelOnSide`, `movePanel`, `findPanelSide`
  - `openReviewPanel`/`closeReviewPanel` 도킹 모델 기반으로 재작성
  - Migration v2→v3 추가 (activeTab→activePanel + panels 배열)
  - **레거시 액션 `openSidebarTab`, `openReviewInSidebar`, `setSidebarTab`은 이미 제거됨** — 호출부가 아직 이 함수들을 참조하므로 Phase 2-4에서 반드시 교체 필요

> **중요**: 현재 `npx tsc --noEmit`은 실패함. `openSidebarTab`, `openReviewInSidebar`, `setSidebarTab`, `activeTab` 참조가 남아있기 때문.

---

## Phase 2: UnifiedSidebar 전면 재작성

### 파일: `src/components/panels/UnifiedSidebar.tsx`

현재 코드는 고정 3탭 (`TAB_CONFIG`) + `activeTab` 기반. 다음으로 변경:

1. **import 변경**: `SidebarTab` → `PanelType`, `SidebarSide` 유지
2. **PANEL_META** (static lookup):
```typescript
const PANEL_META: Record<PanelType, { icon: typeof Settings; labelKey: string }> = {
  settings: { icon: Settings, labelKey: 'chat.settings' },
  review:   { icon: Search, labelKey: 'review.title' },
  chat:     { icon: MessageSquare, labelKey: 'chat.title' },
};
```

3. **State 접근 변경**:
```typescript
// before
const { collapsed, activeTab, width } = useUIStore(useShallow(s => s[sidebarKey]));
const setSidebarTab = useUIStore(s => s.setSidebarTab);
// after
const { collapsed, panels, activePanel, width } = useUIStore(useShallow(s => s[sidebarKey]));
const setActivePanel_side = useUIStore(s => s.setActivePanel_side);
const movePanel = useUIStore(s => s.movePanel);
```

4. **동적 패널 목록**: `panels` 배열에서 탭 렌더링 (기존 고정 3개 → 도킹된 것만)

5. **Collapsed 모드**: 도킹된 패널(`panels`) 아이콘만 표시

6. **빈 사이드바**: `panels.length === 0`일 때 → 얇은 드롭 존(w-4, border-dashed) 렌더링

7. **HTML5 DnD**:
   - 각 탭 `<div>`: `draggable`, `onDragStart` (dataTransfer에 `application/x-panel-dock` + JSON `{panelType, sourceSide}`)
   - `<aside>`: `onDragOver`/`onDragLeave`/`onDrop` 핸들러
   - 시각 피드백: 드래그 중 소스 탭 `opacity-50`, 타깃 사이드바 `ring-2 ring-primary-500/30`
   - `onDrop`에서 `movePanel(panel, from, to)` 호출

8. **우클릭 컨텍스트 메뉴**:
   - 탭 헤더 `onContextMenu` → `useState`로 관리되는 간단한 절대 위치 드롭다운
   - 메뉴 항목: "좌측으로 이동" / "우측으로 이동" (i18n: `chat.moveToLeft`/`chat.moveToRight` — 이미 존재)
   - Chat 탭에는 "반대편에도 열기" 옵션 추가 (i18n: `sidebar.openOnOtherSide`)
   - 메뉴 외부 클릭/ESC로 닫힘

9. **Content 영역**: `activeTab` → `activePanel` 로 조건 변경

---

## Phase 3: ChatContent 업데이트

### 파일: `src/components/chat/ChatContent.tsx`

두 곳 변경:

1. **chatPanelOpen 셀렉터** (line ~126-132):
```typescript
// before
return !sb.collapsed && sb.activeTab === 'chat';
// after
return !sb.collapsed && sb.activePanel === 'chat';
```

2. **focusNonce effect** (line ~386-388):
```typescript
// before
const { openSidebarTab } = useUIStore.getState();
openSidebarTab(side, 'chat');
// after
const { openPanelOnSide } = useUIStore.getState();
openPanelOnSide(side, 'chat');
```

---

## Phase 4: 호출부 마이그레이션

모든 호출부를 side-agnostic API로 변경. **레거시 함수(`openSidebarTab`, `openReviewInSidebar`, `setSidebarTab`)는 스토어에서 이미 삭제됨**.

| 파일 | 변경 전 | 변경 후 |
|------|---------|---------|
| `Toolbar.tsx` | `openSidebarTab('left','settings')` | `openPanel('settings')` |
| `Toolbar.tsx` | `openReviewInSidebar('left')` | `openReviewPanel()` |
| `Toolbar.tsx` | `openSidebarTab('right','chat')` | `openPanel('chat')` |
| `Toolbar.tsx` | `rightSidebar.activeTab==='chat'` 체크 | `findPanelSide('chat')` 기반으로 변경 |
| `Toolbar.tsx` | useShallow 셀렉터에서 `openSidebarTab`, `openReviewInSidebar` | `openPanel`, `openReviewPanel`, `findPanelSide` |
| `EditorCanvasTipTap.tsx:52` | `const openSidebarTab = useUIStore(s => s.openSidebarTab)` | `const openPanel = useUIStore(s => s.openPanel)` |
| `EditorCanvasTipTap.tsx:53` | `const openReviewInSidebar = useUIStore(s => s.openReviewInSidebar)` | `const openReviewPanel = useUIStore(s => s.openReviewPanel)` |
| `EditorCanvasTipTap.tsx:466` | `openReviewInSidebar('left')` | `openReviewPanel()` |
| `EditorCanvasTipTap.tsx:632` | `openSidebarTab('right', 'chat')` | `openPanel('chat')` |
| `TipTapEditor.tsx:139,143` | `openSidebarTab('right', 'chat')` | `openPanel('chat')` |
| `TipTapEditor.tsx:314,318` | `openSidebarTab('right', 'chat')` | `openPanel('chat')` |
| `TargetMonacoEditor.tsx:473,476` | `openSidebarTab('right', 'chat')` | `openPanel('chat')` |
| `TargetMonacoEditor.tsx:557,560` | `openSidebarTab('right', 'chat')` | `openPanel('chat')` |
| `DomSelectionAddToChat.tsx:122` | `ui.openSidebarTab('right', 'chat')` | `ui.openPanel('chat')` |
| `useBlockEditor.ts:83,88` | `openSidebarTab('right', 'chat')` | `openPanel('chat')` |

### Toolbar.tsx 상세 변경:
```typescript
// before
const { openSidebarTab, openReviewInSidebar, toggleSidebarCollapse, rightSidebar } = useUIStore(
  useShallow((s) => ({
    openSidebarTab: s.openSidebarTab,
    openReviewInSidebar: s.openReviewInSidebar,
    toggleSidebarCollapse: s.toggleSidebarCollapse,
    rightSidebar: s.rightSidebar,
  }))
);

// after
const { openPanel, openReviewPanel, toggleSidebarCollapse, findPanelSide, leftSidebar, rightSidebar } = useUIStore(
  useShallow((s) => ({
    openPanel: s.openPanel,
    openReviewPanel: s.openReviewPanel,
    toggleSidebarCollapse: s.toggleSidebarCollapse,
    findPanelSide: s.findPanelSide,
    leftSidebar: s.leftSidebar,
    rightSidebar: s.rightSidebar,
  }))
);

// handleProjectSettings
openPanel('settings');

// handleReview
openReviewPanel();

// handleChat — chat 도킹된 사이드 찾아서 토글
const chatSide = findPanelSide('chat');
if (chatSide) {
  const sb = chatSide === 'left' ? leftSidebar : rightSidebar;
  if (!sb.collapsed && sb.activePanel === 'chat') {
    toggleSidebarCollapse(chatSide);
  } else {
    openPanel('chat');
  }
} else {
  openPanel('chat');
}

// aria-pressed 체크도 activeTab → activePanel로 변경
```

---

## Phase 5: 정리 + i18n

1. i18n 키 추가 (ko.json + en.json):
   - `sidebar.openOnOtherSide`: "반대편에도 열기" / "Open on other side"

2. `npx tsc --noEmit` 통과 확인

3. 참고: `useResponsiveLayout.ts`는 `setSidebarCollapsedSide`만 사용하므로 변경 불필요

---

## 검증 체크리스트

```bash
npx tsc --noEmit  # 타입 오류 0
```
- 좌측에 Settings/Review 탭, 우측에 Chat 탭만 표시
- DnD: Review 탭을 우측으로 드래그 → 좌측=[Settings], 우측=[Review, Chat]
- 우클릭: 탭 우클릭 → "이동" 메뉴 동작
- Cmd+L/K → 채팅 열림 (패널이 도킹된 쪽에서)
- 리뷰 버튼 → 리뷰 열림 (패널이 도킹된 쪽에서)
- Chat 패널 열기/닫기 정상 동작
