# 8. 데이터 영속성 (Data & Storage)

## 8.1 SQLite 기반의 단일 파일 구조 (.ite)

### Why
- 번역 데이터, AI 대화 로그, 수정 이력(History)이 모두 하나의 맥락 안에서 보존되어야 합니다.

### How
- Rust 백엔드에서 `rusqlite`로 프로젝트 DB를 관리하고, 저장 시 단일 `.ite` 파일로 패킹합니다.

### What (Schema 개요)
- `blocks`: 각 문단/문장의 원문 및 번역문 데이터
- `chat_sessions`: 대화 로그 및 컨텍스트 요약본
- `snapshots`: 특정 시점의 전체 텍스트 상태(Version Control)

### What (Project Metadata UX)
- 사이드바에서 Project 이름을 수정(rename)할 수 있어야 한다.
- 변경된 Project 이름은 프로젝트 메타데이터로 저장되며 `.ite`에 영속화되어 재개 시 복원되어야 한다.
