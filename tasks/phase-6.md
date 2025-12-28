# Phase 6: UI/UX 개선 및 버그 수정

**목표**: 사용자 경험 개선 및 안정성 향상.

## 미완료(상세)

### 6.1 UI 개선

- [x] **사이드바 하단: App Settings 옵션 추가**
  - [x] **API Key 입력 UI** ✅
    - 완료 조건: OpenAI/Anthropic 등 Provider별 Key 입력/저장/마스킹(표시 정책) 동작
    - 구현: AppSettingsModal에 password 타입 입력 필드, Clear 버튼, OS 키체인 저장 (localStorage 미사용)
  - [x] **모델 선택 UI** ✅
    - 완료 조건: Provider별 모델 프리셋/커스텀 입력 지원, 실제 호출에 반영
    - 구현: Provider별 프리셋 드롭다운, 커스텀 입력 모드, getAiConfig()에서 실제 사용

- [x] **Preview 모달 Diff 색상 대비 조정** ✅
  - **완료 조건**: 변경/추가/삭제가 다크/라이트 모두에서 명확히 구분됨
  - 구현: VisualDiffViewer에서 다크/라이트 모드 대비 색상 적용
    - 삭제: `bg-red-50/50 dark:bg-red-900/10`, `bg-red-200 dark:bg-red-900/50`
    - 추가: `bg-green-50/50 dark:bg-green-900/10`, `bg-green-200 dark:bg-green-900/50`
    - 수정: `bg-[#eff6ff] dark:bg-blue-900/10`

- [x] **채팅 탭 선택 상태 표시 버그 수정** ✅
  - **증상**: Settings 탭 선택 시에도 채팅 탭 언더라인이 남아있음
  - **완료 조건**: 탭 상태 표시가 실제 activeTab과 정확히 일치
  - 구현: ChatPanel에서 activeTab 상태에 따라 조건부 스타일 적용
    - Settings 탭: `activeTab === 'settings'`일 때 활성화
    - Chat 탭: `activeTab === 'chat' && currentSession?.id === session.id`일 때 활성화


### Low Priority
  - [ ] **Tutorial / FAQ**
    - 완료 조건: 앱 내에서 접근 가능한 간단 가이드/FAQ 화면(또는 링크)
    - 현재 상태: UI에 "Help & Info" 섹션 placeholder 존재 (Coming soon)
  - [ ] **Info**
    - 완료 조건: 앱 버전/빌드 정보, 라이선스/크레딧 등 확인 가능
    - 현재 상태: UI에 "Help & Info" 섹션에 버전 정보 placeholder 존재 (Coming soon)