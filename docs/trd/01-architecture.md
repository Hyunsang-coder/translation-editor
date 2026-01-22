# 1. 아키텍처 개요 (System Architecture)

## 1.1 기반 기술 (The TipTap Document-First Approach)

### Why
- 전문 번역가는 대용량 텍스트를 다루며, 실시간 AI 응답을 검토/수락/거절하는 고부하 작업을 수행합니다.
- 가볍고 네이티브 접근이 가능한 Tauri + Rust, 문서 편집에 적합한 TipTap(ProseMirror) 조합이 유리합니다.

### How
- **Backend (Rust)**: 파일 시스템 제어, SQLite DB 관리, 외부 도구(Sidecar) 실행
- **Frontend (React + TS)**: UI 렌더링, TipTap 인스턴스 관리, 상태 관리(Zustand)

### What
- SQLite 기반 단일 `.ite` 프로젝트 파일을 지원하는 네이티브 데스크톱 애플리케이션
