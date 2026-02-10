# Session Handoff

> Generated: 2026-02-10
> Branch: main

## 작업 요약

**2가지 작업 완료:**

1. **Dual Sidebar v2 도킹 모델** — 이전 세션에서 완성 (미커밋 상태 유지)
2. **Chat Sessions as Independent Tabs** — 이번 세션에서 구현 완료. 채팅 세션을 Settings/Review와 같은 층위의 독립 탭으로 승격. `PanelType`을 template literal 기반(`chat:${sessionId}`)으로 변경하고, chatStore↔uiStore 간 자동 동기화 구현.

> **중요**: 전체 변경사항이 미커밋 상태. `npx tsc --noEmit` 통과 확인됨.

## 현재 상태

### 변경된 파일 (unstaged, 미커밋)

**수정 (16개):**
- `src/types/index.ts` — `PanelType = FixedPanelType | ChatPanelType` + runtime helpers
- `src/stores/uiStore.ts` — 도킹 모델 + chat panel 액션 (addChatPanel, removeChatPanel, syncChatPanels, openActiveChat), v4 migration
- `src/stores/chatStore.ts` — createSession/deleteSession/hydrateForProject에 uiStore 동기화 추가
- `src/components/chat/ChatContent.tsx` — sessionId prop 추가, 내부 세션 탭 바 제거
- `src/components/panels/UnifiedSidebar.tsx` — 함수 기반 PANEL_META, chat 탭 x/+/세션명 표시
- `src/components/layout/Toolbar.tsx` — openActiveChat 마이그레이션
- `src/components/layout/MainLayout.tsx` — Dual Sidebar 레이아웃
- `src/components/editor/EditorCanvasTipTap.tsx` — openActiveChat 마이그레이션
- `src/components/editor/TipTapEditor.tsx` — openActiveChat 마이그레이션
- `src/components/editor/TargetMonacoEditor.tsx` — openActiveChat 마이그레이션
- `src/components/editor/DomSelectionAddToChat.tsx` — openActiveChat 마이그레이션
- `src/hooks/useBlockEditor.ts` — openActiveChat 마이그레이션
- `src/hooks/useResponsiveLayout.ts` — 이전 세션 수정
- `src/i18n/locales/en.json` — sidebar.openOnOtherSide
- `src/i18n/locales/ko.json` — sidebar.openOnOtherSide

**삭제:**
- `src/components/panels/DockedChatPanel.tsx`
- `src/components/panels/SettingsSidebar.tsx`

**신규 (untracked):**
- `src/components/panels/UnifiedSidebar.tsx` — 통합 사이드바
- `src/components/panels/SettingsContent.tsx` — Settings 패널 콘텐츠
- `src/hooks/useResizeHandle.ts` — 양방향 리사이즈 핸들 훅
- `.claude/plans/` — 계획서들

### 커밋 이력 (이번 세션)

없음 (모든 변경사항 미커밋)

## 미완료 작업

### 작업 A: DnD 전환 (도킹 모델 잔여)
- [ ] HTML5 DnD → 마우스 이벤트 기반 DnD 전환
  - `src/hooks/usePanelDrag.ts` 신규 생성
  - `src/components/panels/UnifiedSidebar.tsx` 수정

### 수동 테스트
- [ ] `npm run tauri:dev`로 실행하여 기능 동작 검증
  - 채팅 탭이 사이드바에 세션별로 표시되는지
  - `+` 버튼으로 새 세션 생성
  - `✕` 버튼으로 세션 삭제
  - 프로젝트 전환 시 syncChatPanels 동작
  - localStorage v3→v4 마이그레이션 (기존 'chat' 리터럴 제거)
  - Cmd+L/K 단축키로 openActiveChat 동작

### 커밋
- [ ] 전체 변경사항 커밋

## 핵심 결정 사항

### PanelType = FixedPanelType | ChatPanelType
- **`ChatPanelType = \`chat:${string}\``**: template literal로 세션 ID 인코딩
- **Runtime helpers**: `isFixedPanel()`, `isChatPanel()`, `getChatSessionId()`, `chatPanelId()` — types 파일에 함께 배치
- **이유**: static Record 불가 → 함수 기반으로 전환

### Cross-store 조율
- **chatStore가 uiStore를 호출**: createSession → addChatPanel, deleteSession → removeChatPanel, hydrateForProject → syncChatPanels
- **이유**: chatStore가 이미 projectStore/connectorStore를 호출하는 기존 패턴과 일치

### Chat dual-presence 제거
- movePanel에서 chat 패널도 동일 처리 (from에서 제거 → to에 추가)
- **이유**: 한 세션 = 한 사이드. template literal 타입에서 양쪽 동시 표시는 불필요

### rightSidebar 초기값 panels: []
- chatStore hydration 시 syncChatPanels로 실제 세션 ID 기반 패널 채움
- **이유**: 앱 시작 시 세션 ID를 모르므로 빈 배열로 시작

### localStorage Migration v3→v4
- v3의 'chat' 리터럴을 panels에서 제거
- hydration 시 실제 세션 ID로 대체

### ChatContent 내부 세션 탭 바 완전 제거
- UnifiedSidebar 탭이 세션 관리를 담당하므로 중복 제거
- sessionId prop으로 특정 세션 표시

## 주의사항

- `UnifiedSidebar.tsx`의 HTML5 DnD 코드는 작업 A에서 전면 교체 대상
- `currentSession` desync 위험: 여러 ChatContent 인스턴스가 동시 존재 가능하지만 `currentSession`은 하나. 탭 전환 시 `switchSession` 호출로 동기화 (sessionId useEffect)
- 프로젝트 전환 시 stale chat panel 위험 → `syncChatPanels(sessionIds)`로 전체 동기화
- `composerText`는 v1에서 세션 간 공유 유지 (추후 per-session 분리 가능)

## 핵심 파일

- `src/types/index.ts` — PanelType, runtime helpers (isFixedPanel, isChatPanel, getChatSessionId, chatPanelId)
- `src/stores/uiStore.ts` — 도킹 모델 상태 + chat panel 액션 + v4 migration
- `src/stores/chatStore.ts` — 세션 CRUD + uiStore 동기화
- `src/components/panels/UnifiedSidebar.tsx` — 통합 사이드바 (getPanelIcon/Label, chat 탭 UI)
- `src/components/chat/ChatContent.tsx` — 채팅 콘텐츠 (sessionId prop, 탭 바 제거)

## 다음 세션 가이드

### 권장 순서

1. `npm run tauri:dev`로 실행 → 수동 테스트 (위 체크리스트 참조)
2. 이슈 발견 시 수정
3. 작업 A (DnD 전환) 진행 — `usePanelDrag.ts` 생성, UnifiedSidebar 수정
4. 전체 변경사항 커밋
