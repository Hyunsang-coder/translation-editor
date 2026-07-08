# 사이드바 완전 숨김 리팩터 — 구현 계획 (핸드오프)

> 작성: 2026-07-08 세션. 이 문서만 읽고 새 세션에서 바로 구현 착수 가능하도록 정리.
> 상태: **구현 완료 (2026-07-08).** typecheck·전체 유닛 테스트(799 pass)·vite build 통과.
>
> ## 구현 요약
> - `DockingSidebarState.collapsed` → `hidden`. `SIDEBAR_COLLAPSED`/`SIDEBAR_EMPTY` 상수 제거.
> - `layoutResolver.getDesiredWidth`: hidden→0, 빈 바→0.
> - `uiStore`: `toggleSidebarHidden`/`setSidebarHiddenSide` 액션, 되살림 16곳 `hidden:false`, 자동 숨김 `hidden:true`,
>   `movePanel` 역할 가드(좌=고정/우=채팅), `syncChatPanels` 좌측 chat→우측 정규화, `addChatPanel` 우측 고정,
>   persist v5→**v6** 마이그레이션(collapsed→hidden 리네임 + 역할 재배치).
> - `UnifiedSidebar`: `if (hidden || panels.length===0) return null`, 48px 레일·16px 드롭존·우클릭 이동 메뉴 제거,
>   헤더 hide 버튼(PanelLeft/RightClose), `+` 버튼 우측 전용.
> - `useResponsiveLayout`: 좁은 창에서 `setSidebarHiddenSide(side,true)`(완전 숨김).
> - predicate 3곳(App/Toolbar/ChatContent) `!collapsed`→`!hidden`.
> - `MainLayout`: 에디터 가장자리 되살림 버튼(좌=`setSidebarHiddenSide('left',false)`, 우=`openActiveChat()`).
> - i18n: `common.hide`/`common.show`, `sidebar.showLeft`/`showRight` 추가, dead `chat.moveToRight`/`moveToLeft` 제거.
> - 테스트: `layoutResolver.test`(hidden→0 재계산), `uiStore.test`(역할 가드·우측 정규화·toggleChatVisibility 재작성).
>
> ## 아래는 원본 설계 문서 (참조용)

## 1. 목표 (사용자 요구)

에디터 좌측 바(설정/검수/코멘트)와 우측 바(채팅)를 **맨 좌측 프로젝트 사이드바처럼 폭 0으로 완전히 숨길 수 있게** 만든다. 지금은 접어도 48px 아이콘 레일이 남는다.

## 2. 확정된 설계 결정 (전부 사용자 승인)

| 항목 | 결정 | 비고 |
|------|------|------|
| **숨김 모델** | `collapsed`(48px 아이콘 레일) 개념을 **완전 제거** → `hidden`(폭 0) 2단계: **펼침 ↔ 완전 숨김** | 프로젝트 사이드바와 동일 모델. hidden/collapsed 공존 리스크가 근본 소멸 |
| **바 역할 고정** | 좌 = 고정 패널(settings/review/comments) 전용, 우 = 채팅 전용. **양방향 이동 완전 차단** | `movePanel` 내부 한 곳에 역할 가드 |
| **되살림 진입점** | **에디터 가장자리에 상시 토글 버튼**(VS Code 사이드바 복귀 버튼 스타일) + 기존 툴바/메뉴/단축키 | 숨긴 바 안에는 UI가 없으므로 에디터 쪽에 노출 |
| **반응형 자동 접기** | **유지**하되 좁은 창에서 48px 레일 대신 **완전 숨김(폭 0)** | 좌<1000px, 우<800px 브레이크포인트 그대로 |
| **빈 바 폭** | **폭 0 완전 숨김** (`SIDEBAR_EMPTY` 16px 제거) | cross-side 드롭 차단으로 드롭존 무의미 → 빈-vs-hidden 폭 모호성도 자연 해소 |
| **마이그레이션** | v5→**v6**: `collapsed`→`hidden` 리네임 + `syncChatPanels` 역할 정규화 | 기존 사용자가 채팅을 좌측에 둔 상태 강제 교정 |
| **프로젝트별 레이어** | **도입 안 함** | project.id로 remount 시 TipTap 파괴/재생성 비용 + 기존 no-remount 가드 3곳 충돌. 숨김 기능만으로 목표 달성 가능 |
| **legacy `sidebarCollapsed`** | **건드리지 않음** | 도킹과 무관한 별도 flat 플래그 (uiStore, types L397). 범위 밖 |

## 3. 아키텍처 현황 (배경)

- 레이아웃은 flexbox 한 줄: `MainLayout.tsx:109` `<main flex row>`
  ```
  ProjectSidebar | UnifiedSidebar(left) | Editor(flex-1 min-w-400) | UnifiedSidebar(right)
  ```
- **좌/우 바는 같은 컴포넌트** `UnifiedSidebar`의 `side="left"|"right"` 인스턴스.
- 프로젝트 사이드바(`ProjectSidebar`)는 이미 **완전 숨김**(`projectSidebarCollapsed` → `return null`, 폭 0). 이것이 좌/우 바에 이식할 참조 패턴.
- 상태는 전부 `uiStore`(`ite-ui-storage`, persist **version 5**). `DockingSidebarState = { collapsed, panels, activePanel, width }` (types/index.ts:370-375).
- 폭 계산은 순수함수 `layoutResolver.ts`. `getProjectWidth`는 이미 `hidden→0` 분기 보유(L35-38) — **좌/우 바용 `getDesiredWidth`(L28-32)에 이 패턴 복사가 핵심.**

## 4. 구현 체크리스트 (파일별)

> 태그: [REMOVE] 삭제 / [REPLACE] collapsed→hidden 치환 / [ADD] 신규 / [KEEP] 유지확인 / [TEST]

### 4.1 `src/types/index.ts`
- [REPLACE] `DockingSidebarState.collapsed: boolean` (L371) → `hidden: boolean`
- [KEEP] `sidebarCollapsed`(L397), `projectSidebarCollapsed`(L398) — 무관, 유지

### 4.2 `src/constants/layout.ts`
- [REMOVE] `SIDEBAR_COLLAPSED: 48` (L16) — 제거 후 참조 없음 (확인됨)
- [REMOVE] `SIDEBAR_EMPTY: 16` (L18) — 빈 바 폭 0 결정으로 불필요
- [KEEP] `PROJECT_COLLAPSED: 48` (L26) — 프로젝트 사이드바용

### 4.3 `src/stores/layoutResolver.ts`  ⭐ 핵심
- [REPLACE] `getDesiredWidth` (L28-32): 새 순서
  ```ts
  function getDesiredWidth(sidebar: DockingSidebarState): number {
    if (sidebar.hidden) return 0;          // ← 신규, 최우선
    if (sidebar.panels.length === 0) return 0;  // 빈 바도 0 (SIDEBAR_EMPTY 제거)
    return sidebar.width;
  }
  ```
- [REPLACE] `leftOpen`/`rightOpen` (L58-59): `&& !input.leftSidebar.collapsed` → `&& !input.leftSidebar.hidden`
- [KEEP] 나머지 예산 수학(L66-108)은 hidden→0이면 그대로 성립. `getMaxSidebarWidth`(L105) `otherW`도 hidden 바를 0으로 처리해 자동 정상.
- **FLAG**: 빈 바 desired가 16→0으로 바뀌므로 `leftOpen=false && 빈 바`일 때 `fixedLeft=0`. division-by-zero 없음(열린 바만 ratio 계산).

### 4.4 `src/stores/uiStore.ts`  ⭐ 가장 넓음
**기본 상태**
- [REPLACE] `leftSidebar`(L169), `rightSidebar`(L170): `collapsed: false` → `hidden: false`

**전용 액션**
- [REPLACE] `toggleSidebarCollapse` (L92, L449-452) → `toggleSidebarHidden` (toggle `hidden`)
- [REPLACE] `setSidebarCollapsedSide` (L93, L454-457) → `setSidebarHiddenSide(side, hidden)`

**개방 side-effect: `collapsed: false` → `hidden: false` (16곳)** ⚠️ **하나라도 빠지면 그 진입점이 먹통**
L305, L309 (openReviewPanel) / L324, L327 (openCommentsPanel) / L355 (toggleSettingsPanel) / L412, L425 (toggleChatVisibility) / L476 (openPanel) / L484, L487 (openPanelOnSide) / L515 (movePanel) / L545 (addChatPanel) / L620 (syncChatPanels) / L634, L643, L656 (openActiveChat)

**자동 접기: `collapsed: true` → `hidden: true` (4곳)**
- L357 (toggleSettingsPanel 끄기), L373 (toggleReviewPanel 끄기), L413 (toggleChatVisibility 폴백 없음), L511 (movePanel 비운 소스), L557 (removeChatPanel 비운 바)
  - 비운 바는 `panels.length===0`이라 어차피 폭 0. `hidden:true`와 중복이지만 명시적 유지 권장(예측 가능).

**predicate**
- [REPLACE] `toggleChatVisibility` 내 `isChatVisibleOn` (L398): `!sb.collapsed` → `!sb.hidden`

**역할 가드 (신규)** ⭐
- [ADD] `movePanel` (L491-517) 진입부: 채팅→좌측, 고정패널→우측 거부. 드래그·우클릭·+버튼 3경로를 한 곳에서 차단.
  ```ts
  // side lock: 좌=고정패널, 우=채팅
  if (toSide === 'left' && isChatPanel(panel)) return state;
  if (toSide === 'right' && !isChatPanel(panel)) return state;
  ```

**syncChatPanels 정규화 (신규)** ⭐
- [ADD] `syncChatPanels` (L563-625): 좌측에 있는 chat 패널을 우측으로, 우측에 있는 고정 패널을 좌측으로 강제 이동시키는 정규화. 기존 `restoreSide` 로직(L607-612)이 좌측 채팅을 재고정하지 않도록 우측 고정.

**persist migrate + version bump** ⭐
- [REPLACE] 마이그레이션 내 `collapsed:` 키들: L762, L769 (v0/v1), L780, L786 (v2), L822 (v5) → `hidden:`
- [ADD] **version 5 → 6**, v6 스텝: 기존 `leftSidebar.collapsed`/`rightSidebar.collapsed` → `hidden` 리네임 + 역할 위반 패널 재배치(좌측 chat→우측, 우측 fixed→좌측)
- [KEEP] `partialize`(L838-839)는 전체 사이드바 객체 저장 → 리네임은 migrate에서 처리

### 4.5 `src/components/panels/UnifiedSidebar.tsx`  ⭐
- [REPLACE] `collapsed` 구독 (L61) → `hidden`
- [REPLACE] `toggleSidebarCollapse` 구독 (L66) → `setSidebarHiddenSide`/`toggleSidebarHidden`
- [ADD] `if (hidden) return null;` — 렌더 **최상단**(빈/collapsed 분기보다 먼저), ProjectSidebar.tsx:102-104 패턴
- [REMOVE] 48px 아이콘 레일 렌더 분기 전체 (L174-201, `w-12`)
- [REMOVE] 빈 바 16px 드롭존 (L165-172, `w-4`) — 빈 바 폭 0 결정. (렌더 안 함 = hidden과 동일 취급, 또는 상위 hidden 조건에서 흡수)
- [REPLACE] 헤더 "접기" 버튼 (L230-241): `toggleSidebarCollapse` → hide 액션. `title`은 hide 문자열로(§4.9)
- [REMOVE] 우클릭 "다른 쪽 이동" 컨텍스트 메뉴 (L131-134 `handleMoveToOtherSide`, L311-326 렌더) — move 차단으로 死. i18n `chat.moveToRight`/`moveToLeft`도 정리
- [REPLACE/REMOVE] `+` 새 채팅 버튼 (L148-156, L287-296): 좌측 바에서는 숨김(좌=고정패널 전용). 우측에서만 노출. `handleAddChatSession`의 right→left 이동(L154) 제거
- [FLAG] 드래그 cross-side drop 차단은 `movePanel` 가드가 최종 방어. `usePanelDrag.ts:184` 드롭 핸들러에서도 조기 차단하면 UX(무효 드롭 시각) 개선 가능 — 선택.

### 4.6 `src/hooks/usePanelDrag.ts`
- [FLAG] L179-187 `store.movePanel(...)` 호출 → movePanel 가드가 거부하면 no-op. 드래그 오버 시 타 사이드 드롭존 하이라이트를 role-invalid일 때 끄면 더 명확(선택).

### 4.7 `src/hooks/useResponsiveLayout.ts`
- [REPLACE] L60 `setSidebarCollapsedSide` 구독 → `setSidebarHiddenSide`
- [REPLACE] L72-74 (좌<1000), L77-79 (우<800): `setSidebarCollapsedSide(side, true)` → `setSidebarHiddenSide(side, true)` — 이제 완전 숨김
- [KEEP] 프로젝트 사이드바 반응형(L64-69) 무관, 유지
- [ADD] 주석(L8-23 BREAKPOINTS "축소:48px") 실제 동작(완전 숨김)에 맞게 갱신

### 4.8 predicate / 메뉴 체크마크
- [REPLACE] `App.tsx` L60-63 `isViewChatOn`: `!leftSidebar.collapsed`/`!rightSidebar.collapsed` → `!hidden`
- [REPLACE] `Toolbar.tsx` L84-87 `isAnyChatVisible` (aria-pressed L176) → `!hidden`
- [REPLACE] `ChatContent.tsx` L174-182 `chatPanelOpen` (L179 `!sb.collapsed`) → `!sb.hidden`
- [KEEP] `src-tauri/src/lib.rs` `set_view_chat_menu_checked`(L219-231) — bool만 받음, **Rust 변경 불필요**

### 4.9 i18n (`src/i18n/locales/en.json`, `ko.json`)
- [ADD/REPLACE] `UnifiedSidebar` L235 `t('common.collapse','Collapse')` — 키 미존재(인라인 폴백). hide 문자열 신규 키 `common.hide`/`common.show` 추가 or 기존 `common.close` 재사용 결정
- [REMOVE] `chat.moveToRight`/`chat.moveToLeft` (양 로케일 L480-481) — 컨텍스트 메뉴 제거로 死
- [KEEP] `projectSidebar.showSidebar`/`collapseSidebar` (L240-241) — 프로젝트 사이드바용, 무관

### 4.10 에디터 가장자리 토글 버튼 (신규 UI) ⭐
- [ADD] 에디터 컬럼(`MainLayout.tsx:121-150` 중간 영역) 좌/우 가장자리에, **해당 바가 hidden일 때만** 나타나는 얇은 토글 버튼. 클릭 시 `setSidebarHiddenSide(side, false)`.
  - 우측 바가 채팅이고 세션이 없을 수 있음 → 우측 토글은 `openActiveChat()`(hidden도 풀도록 §4.4 반영) 경로가 자연스러움. 좌측은 마지막 activePanel 복원 or 기본 settings.
  - 배치: MainLayout 또는 EditorCanvasTipTap 가장자리. 디자인/정확한 위치는 구현 시 확정(핸드오프 미확정 항목).

## 5. 테스트

### 5.1 수정 필요 (기존)
- [TEST] `src/stores/uiStore.test.ts`
  - L13-55 `syncChatPanels` — 채팅을 **좌측**에 복원한다고 단언(L27, L53). 정규화 후 채팅은 우측만 → 재작성
  - L58-98 `toggleChatVisibility` — fixture가 채팅을 좌측에 도킹(L64-69), 단언 L83/L85/L94/L96 `collapsed` → `hidden`, 역할 규칙 반영 재작성
- [TEST] `src/stores/layoutResolver.test.ts`
  - 모든 fixture `collapsed:` → `hidden:` (L9,10,26,27,42,43,57,58,71,72,80,81,92,93,105,106,119,120,142,150,160)
  - collapsed→48 단언 재계산: L62/L84/L85 `SIDEBAR_COLLAPSED`(48) → hidden→0. 예산 수학 코멘트(L61-66,L152) 갱신
  - L69-76 "빈 사이드바 SIDEBAR_EMPTY(16)" → 빈 바 0으로 변경

### 5.2 추가 권장 (신규)
- [TEST] layoutResolver: 양쪽 hidden→`{0,0}`; 한쪽 hidden·다른쪽 open → open 바가 hidden 바 예산 없이 배분
- [TEST] uiStore movePanel 역할 가드: 채팅→좌측 거부, 고정패널→우측 거부
- [TEST] uiStore v6 마이그레이션: 좌측 chat 있는 v5 상태 → 우측으로 이동 + collapsed→hidden

### 5.3 E2E (프로젝트 규칙상 UI 변경 대상)
- 좌/우 바 숨기기 → 에디터 폭 확장 확인 → 에디터 가장자리 버튼으로 되살림
- Cmd+L(채팅 열기)가 숨김 상태에서도 우측 바를 되살리는지
- 드래그로 채팅을 좌측에 못 놓는지
- `/e2e-scenario`로 시나리오 생성 권장

## 6. ⚠️ 절대 놓치면 안 되는 것

1. **되살림 액션 전부가 `hidden`도 풀어야 한다** (§4.4의 16곳). 하나라도 빠지면 Cmd+L / 툴바 채팅 / 검수·코멘트 열기 / 메뉴가 **조용히 no-op**. → `collapsed:false`→`hidden:false` 일괄 치환으로 커버됨. grep으로 잔여 `collapsed` 확인 필수.
2. **역할 가드는 `movePanel` 한 곳에** — 드래그·우클릭·+버튼 3경로를 동시에 막음.
3. **v6 마이그레이션 없으면** 기존 사용자의 좌측 채팅이 `syncChatPanels`에 의해 매 hydrate마다 좌측으로 재고정됨.
4. **predicate 3곳**(`isViewChatOn`/`isAnyChatVisible`/`chatPanelOpen`)을 `!hidden`으로 안 바꾸면 "폭 0인데 채팅 켜짐"으로 메뉴 체크마크/aria 불일치.

## 7. 권장 진행 순서

1. `layoutResolver.ts` + `layout.ts` + 타입 (§4.1-4.3) → resolver 유닛테스트부터 (TDD)
2. `uiStore.ts` 액션·마이그레이션·역할가드 (§4.4) → uiStore 테스트
3. `UnifiedSidebar.tsx` 렌더/버튼/컨텍스트메뉴 (§4.5)
4. `useResponsiveLayout` + predicate 3곳 (§4.7-4.8)
5. 에디터 가장자리 토글 버튼 (§4.10) — 디자인 확정 필요
6. i18n (§4.9)
7. `npx tsc --noEmit` → `npm run test:run` → 잔여 `collapsed` grep → E2E

## 8. 검증 기준

- `grep -rn "\.collapsed" src/` 결과에 도킹 사이드바 관련 잔여 없음(프로젝트/legacy만 남음)
- `npx tsc --noEmit` 통과
- `npm run test:run` 통과(수정된 테스트 포함)
- 실제 앱: 좌/우 바 숨김 → 에디터 확장 → 에디터 버튼/Cmd+L/툴바로 되살림 전부 동작
- 채팅을 좌측으로 드래그 불가, 고정패널을 우측으로 드래그 불가
