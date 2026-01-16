# 8. 데이터 영속성 (Data & Storage)

## 8.1 SQLite 기반의 단일 파일 구조 (.ite)

### Why
- 번역 데이터, AI 대화 로그, 수정 이력(History)이 모두 하나의 맥락 안에서 보존되어야 합니다.

### How
- Rust 백엔드에서 `rusqlite`로 프로젝트 DB를 관리하고, 저장 시 단일 `.ite` 파일로 패킹합니다.

### What (Schema 개요)

#### 핵심 테이블
- `projects`: 프로젝트 메타데이터 (id, version, metadata_json, timestamps)
- `blocks`: 원문/번역문 데이터 (id, project_id, block_type[source|target], content, hash, metadata_json)
- `segments`: N:M 매핑 (source_ids/target_ids를 JSON Array로 관리, is_aligned, segment_order)
- `history`: 수정 이력 (changes_json, chat_summary)

#### 채팅 관련 테이블
- `chat_sessions`: 채팅 세션 (id, project_id, name, context_block_ids)
- `chat_messages`: 메시지 (session_id, role[user|assistant|system], content, metadata_json)
- `chat_project_settings`: 프로젝트별 채팅 설정 (settings_json)

#### 참조 데이터 테이블
- `glossary_entries`: 용어집 (project_id NULL이면 전역, source, target, notes, domain, case_sensitive)
- `attachments`: 첨부 파일 (project_id, filename, file_type, file_path, extracted_text)
- `mcp_servers`: MCP 서버 설정 (name, server_type, config_json, is_enabled)

### 인덱스
- `idx_blocks_project`, `idx_blocks_type`: 블록 조회 최적화
- `idx_segments_project`, `idx_segments_order`: 세그먼트 정렬
- `idx_history_project`, `idx_history_timestamp`: 히스토리 조회
- `idx_chat_sessions_project`, `idx_chat_messages_session`, `idx_chat_messages_timestamp`: 채팅 조회
- `idx_glossary_project`, `idx_glossary_source`: 용어집 검색
- `idx_attachments_project`: 첨부 파일 조회

### What (Project Metadata UX)
- 사이드바에서 Project 이름을 수정(rename)할 수 있어야 한다.
- 변경된 Project 이름은 `projects.metadata_json` 내 `title` 필드로 저장되며 `.ite`에 영속화되어 재개 시 복원되어야 한다.
