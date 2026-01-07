# Phase 7: 사용자 경험 개선

**목표**: 테마, 단축키, 튜토리얼, 보안 등 사용자 경험 향상.

## 계획

### 7.1 테마 및 시각적 개선

- [x] **다크 모드/라이트 모드 지원**
  - [x] 테마 전환 UI 구현
  - [x] 시스템 테마 감지 및 자동 전환 옵션
  - [x] 모든 컴포넌트 다크 모드 스타일 적용

### 7.2 단축키 및 접근성

- [ ] **단축키 커스텀 설정**
  - [ ] 단축키 설정 UI
  - [ ] 사용자 정의 단축키 저장/로드
  - [ ] 단축키 충돌 감지 및 해결

### 7.3 도움말 및 정보

- [ ] **Tutorial / FAQ**
  - 완료 조건: 앱 내에서 접근 가능한 간단 가이드/FAQ 화면(또는 링크)
  - 현재 상태: UI에 "Help & Info" 섹션 placeholder 존재 (Coming soon)

- [ ] **Info**
  - 완료 조건: 앱 버전/빌드 정보, 라이선스/크레딧 등 확인 가능
  - 현재 상태: UI에 "Help & Info" 섹션에 버전 정보 placeholder 존재 (Coming soon)

### 7.4 보안 개선 (Secret Manager)

- [x] **Master Key + Encrypted Vault 패턴 구현**
  - [x] Keychain에 마스터키 1개만 저장 (앱 시작 시 1회 인증)
  - [x] 모든 시크릿을 `secrets.vault`에 XChaCha20-Poly1305 AEAD로 암호화 저장
  - [x] `.ite` export에 시크릿 포함되지 않도록 보장

- [x] **레거시 마이그레이션**
  - [x] Settings → Security에 "기존 로그인 정보 가져오기" 버튼
  - [x] 기존 Keychain 항목을 Vault로 마이그레이션

- [x] **커넥터 토큰 관리**
  - [x] Atlassian OAuth 토큰 영속화 및 자동 갱신
  - [x] Notion Integration Token 영속화
  - [x] 연결 해제 시 토큰 유지 (disconnect vs logout 분리)
  - [x] 재연결 시 기존 토큰 재사용 가능 (마스킹된 토큰 표시)

### 7.5 기타 UX 개선

- [ ] 타임라인 기반 수정 이력 UI (Smart History)
- [ ] 추가 UX 개선 사항 (필요 시)


