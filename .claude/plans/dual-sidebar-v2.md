# Dual Sidebar Architecture v2 - 계획 수립 요청

## 목표

현재 세션에서 구현한 "양쪽 동일 탭 복제" 방식을 **패널 도킹 모델**로 재설계한다.

## 현재 상태 (이번 세션에서 변경됨, 아직 커밋 안됨)

### 새로 만든 파일
- `src/components/panels/UnifiedSidebar.tsx` — 좌/우 공용 사이드바 (3탭 고정: Settings/Review/Chat)
- `src/components/panels/SettingsContent.tsx` — Settings 탭 콘텐츠 (SettingsSidebar에서 추출)
- `src/hooks/useResizeHandle.ts` — 리사이즈 핸들 훅 (direction: left/right)

### 삭제된 파일
- `src/components/panels/DockedChatPanel.tsx`
- `src/components/panels/SettingsSidebar.tsx`

### 수정된 파일
- `src/types/index.ts` — `SidebarTab`, `SidebarSide`, `SidebarState` 타입 추가
- `src/stores/uiStore.ts` — `leftSidebar`/`rightSidebar` 상태, 6개 액션, persist v1→v2 migration
- `src/components/layout/MainLayout.tsx` — `<UnifiedSidebar side="left"/>` + `<UnifiedSidebar side="right"/>`
- `src/components/layout/Toolbar.tsx` — `openSidebarTab`/`openReviewInSidebar` 사용
- `src/components/chat/ChatContent.tsx` — `side` prop 추가, sidebar state로 visibility 판단
- `src/hooks/useResponsiveLayout.ts` — `setSidebarCollapsedSide` 사용
- `src/components/editor/*` — `openSidebarTab('right', 'chat')` 사용

### 현재 문제점
**양쪽 사이드바에 Settings/Review/Chat 3개 탭이 동일하게 복제됨.** 이것은 원래 의도와 다름.

## 올바른 설계 (확정된 요구사항)

### 핵심 모델: 패널 도킹

| 패널 | 드래그 이동 | 양쪽 동시 존재 | 비고 |
|------|-----------|-------------|------|
| Settings | 좌↔우 | **불가** (단일 인스턴스) | 하나의 위치에만 존재 |
| Review | 좌↔우 | **불가** (단일 인스턴스) | 하나의 위치에만 존재 |
| Chat | 좌↔우 | **가능** (양쪽 각각) | 각 사이드바에서 독립적 세션 선택 |

### 상태 모델 (재설계 필요)

```
Settings → docked: 'left' | 'right' (기본: 'left')
Review   → docked: 'left' | 'right' (기본: 'left')
Chat     → 특수: 양쪽 모두 존재 가능, 각 side별 독립 세션 ID 추적
```

### 사이드바 구성
각 사이드바는 **자기에게 도킹된 패널들만** 탭으로 표시한다.

- 기본: 좌측=[Settings, Review], 우측=[Chat]
- 사용자가 Review 탭을 우측으로 드래그 → 좌측=[Settings], 우측=[Review, Chat]
- Chat은 양쪽에 열 수 있으므로 좌측에도 Chat 탭이 나타날 수 있음

### 탭 드래그 앤 드롭 UX
- 탭 헤더를 드래그하여 반대쪽 사이드바에 드롭하면 해당 패널이 이동됨 (VS Code 스타일)
- Settings/Review: 이동 시 원래 위치에서 사라짐
- Chat: 이동이 아니라, 양쪽에 독립적으로 열기/닫기 가능

### Chat 세션 관리
- chatStore의 `currentSessionId`는 "마지막 상호작용 세션" 용도로 유지
- 각 사이드바의 Chat은 **자체적으로 보고 있는 세션 ID를 추적** (uiStore에 `leftChatSessionId`, `rightChatSessionId` 등)
- 좌측 Chat에서 세션 A를 보면서 우측 Chat에서 세션 B를 동시에 볼 수 있음

## 구현 전략 (계획서에 포함해야 할 사항)

1. **타입 재설계**: `SidebarState` 대신 패널별 도킹 위치 추적 모델
2. **uiStore 재설계**: 패널 도킹 상태, Chat 사이드별 세션 ID, 탭 순서
3. **UnifiedSidebar 수정**: 고정 3탭 → 도킹된 패널만 탭으로 렌더링
4. **탭 드래그 앤 드롭**: 탭 헤더 드래그 → 반대쪽 드롭 존 → 도킹 위치 변경
5. **ChatContent 수정**: `side` prop으로 어떤 세션을 보여줄지 결정
6. **persist migration**: v2 → v3 (현재 v2 데이터를 새 모델로 변환)
7. **호출부 재확인**: Toolbar, Editor 단축키 등

## 주의사항

- `useResizeHandle`, `SettingsContent`는 재활용 가능 (이번 세션에서 잘 만들어짐)
- typecheck (`npx tsc --noEmit`) 및 test (`npm run test:run`) 각 Phase 완료 후 실행
- 각 Phase 완료 후 typecheck 실행하여 타입 오류 확인
- 리사이즈 핸들: left는 delta = e.clientX - startX, right는 delta = startX - e.clientX
