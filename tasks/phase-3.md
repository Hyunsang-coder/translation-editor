# Phase 3: 데이터 관리 및 .ite 파일 시스템

**목표**: SQLite 기반 프로젝트 저장, TipTap JSON 저장/복원.

## 완료(요약)

- [x] rusqlite 연동 및 기본 테이블/스키마 구성
- [x] 프로젝트 create/load/save Tauri Command
- [x] `.ite` 파일 패킹/언패킹
- [x] 최근 프로젝트 목록 + Auto-save
- [x] Import/Export
- [x] TipTap JSON 저장/복원(프로젝트 구조에 통합)
- [x] 프로젝트별 채팅 세션 저장/복원 (Zustand persist)
- [x] 멀티 탭 채팅 세션 저장 구조 확장
- [x] Settings(시스템 프롬프트/번역 규칙/Active Memory 등) 저장
- [x] 채팅 히스토리 정책 정리: translate는 히스토리 미포함, question은 최근 10개만 포함
- [x] 프로젝트 변경 시 패널 동기화 검증 (간혹 동기화 이슈 기록됨)


