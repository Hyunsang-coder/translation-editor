//! Database Schema
//!
//! SQLite 테이블 스키마 정의

/// 데이터베이스 스키마 생성 SQL
pub const CREATE_SCHEMA: &str = r#"
-- 프로젝트 테이블
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 블록 테이블
CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    block_type TEXT NOT NULL CHECK (block_type IN ('source', 'target')),
    content TEXT NOT NULL,
    hash TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 블록 인덱스
CREATE INDEX IF NOT EXISTS idx_blocks_project ON blocks(project_id);
CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(block_type);

-- 세그먼트 테이블 (N:M 매핑)
CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_ids TEXT NOT NULL,  -- JSON Array
    target_ids TEXT NOT NULL,  -- JSON Array
    is_aligned INTEGER NOT NULL DEFAULT 1,
    segment_order INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 세그먼트 인덱스
CREATE INDEX IF NOT EXISTS idx_segments_project ON segments(project_id);
CREATE INDEX IF NOT EXISTS idx_segments_order ON segments(segment_order);

-- 히스토리 테이블
-- kind: 스냅샷 종류. description(사용자가 자유롭게 rename 가능한 표시 문자열)으로
-- 종류를 판별하면 rename 한 번에 수동 스냅샷이 자동 슬롯의 덮어쓰기 대상이 되므로,
-- 판별은 반드시 이 컬럼으로만 한다.
CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    description TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    snapshot_json TEXT,
    chat_summary TEXT,
    kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'auto')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 히스토리 인덱스
CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
-- NOTE: "프로젝트당 auto 1개" 부분 유니크 인덱스는 여기가 아니라
-- Database::run_migrations에서 만든다. CREATE_SCHEMA는 기존 DB에서도 매번 먼저
-- 실행되는데, 그 시점엔 아직 kind 컬럼이 추가되기 전이라 여기 두면 실패한다.

-- 채팅 세션 테이블
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    context_block_ids TEXT NOT NULL,  -- JSON Array
    confluence_search_enabled INTEGER NOT NULL DEFAULT 1,
    model_preset TEXT,  -- 세션별 채팅 모델 프리셋 ID (NULL이면 프런트가 전역 기본값 상속)
    memory_json TEXT,  -- 장기 대화 요약 상태(ChatSessionMemory) JSON (NULL이면 요약 없음)
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 채팅 메시지 테이블
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- 채팅 인덱스
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);

-- 채팅 설정(프로젝트별)
-- ChatPanel의 systemPromptOverlay/referenceNotes/projectContext/include flags 등을 JSON으로 저장
CREATE TABLE IF NOT EXISTS chat_project_settings (
    project_id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 사용자 승인을 거쳐 프로젝트 전체에서 재사용되는 구조화 메모리
CREATE TABLE IF NOT EXISTS project_memory_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (
        category IN (
            'domain', 'audience', 'product', 'worldbuilding', 'character',
            'intent', 'decision', 'reference_fact', 'general'
        )
    ),
    content TEXT NOT NULL,
    normalized_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed', 'active')),
    source TEXT NOT NULL CHECK (source IN ('user', 'chat', 'review', 'import', 'legacy')),
    source_session_id TEXT,
    source_message_id TEXT,
    source_selection_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_memory_project_status
    ON project_memory_items(project_id, status);
CREATE INDEX IF NOT EXISTS idx_project_memory_project_hash
    ON project_memory_items(project_id, category, normalized_hash);

-- ContextSnapshot이 참조하는 프로젝트 컨텍스트 revision
CREATE TABLE IF NOT EXISTS project_memory_state (
    project_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Translation Rules/Glossary와 분리된 프로젝트 금칙어
CREATE TABLE IF NOT EXISTS forbidden_terms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    term TEXT NOT NULL,
    replacement TEXT,
    note TEXT,
    enabled INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forbidden_terms_project
    ON forbidden_terms(project_id);

-- 이름 있는 앱 전역 용어집
CREATE TABLE IF NOT EXISTS glossaries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 프로젝트에서 사용할 용어집과 검색 우선순위
CREATE TABLE IF NOT EXISTS project_glossaries (
    project_id TEXT NOT NULL,
    glossary_id TEXT NOT NULL,
    priority INTEGER NOT NULL,
    PRIMARY KEY (project_id, glossary_id),
    UNIQUE (project_id, priority),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (glossary_id) REFERENCES glossaries(id) ON DELETE CASCADE
);

-- 용어집 엔트리의 레거시 부트스트랩 스키마.
-- Database::run_migrations가 glossary_id 소유권 스키마로 원자적으로 재구성합니다.
-- 기존 DB에서도 CREATE_SCHEMA 전체가 먼저 실행되므로 여기서는 project_id를 유지해야 합니다.
CREATE TABLE IF NOT EXISTS glossary_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT,  -- NULL이면 전역 용어집
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    notes TEXT,
    domain TEXT,
    case_sensitive INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 첨부 파일 테이블
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_path TEXT,
    extracted_text TEXT,
    file_size INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 첨부 파일 인덱스
CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments(project_id);

-- 인라인 코멘트 테이블 (텍스트 마킹 + 코멘트)
-- 마크 span 자체는 blocks.content HTML에 영속되고, 코멘트 본문/메타만 여기 저장
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    field TEXT NOT NULL CHECK (field IN ('source', 'target')),
    segment_group_id TEXT,
    excerpt TEXT NOT NULL,
    comment TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 코멘트 인덱스
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id);

-- MCP 서버 설정 테이블
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- AI 토큰 사용량 장부: 모델 호출 1회(도구 루프는 그 루프 전체) = 1행.
--
-- project_id에 의도적으로 FK를 걸지 않는다. 다른 테이블처럼 ON DELETE CASCADE를 걸면
-- 프로젝트를 지울 때 과거 사용량이 함께 사라져 "일별 누적 비용"이라는 목적이 무너진다.
-- 참조 무결성 대신 기록 보존을 택한다(프로젝트별 분해는 best-effort).
CREATE TABLE IF NOT EXISTS ai_usage_records (
    id TEXT PRIMARY KEY,
    project_id TEXT,                          -- 삭제된 프로젝트의 기록도 남는다 (FK 없음)
    occurred_at INTEGER NOT NULL,             -- epoch ms
    feature TEXT NOT NULL,                    -- chat | translate | review | polish | selection-retranslate | summary
    provider TEXT NOT NULL,                   -- openai | anthropic
    model TEXT NOT NULL,                      -- 실제 호출된 API 모델 ID
    input_tokens INTEGER NOT NULL DEFAULT 0,  -- 캐시 read/write를 제외한 순수 입력
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,      -- ~0.1x 과금
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,  -- 5m TTL 기준 1.25x 과금
    model_calls INTEGER NOT NULL DEFAULT 1    -- 도구 루프에서 실제 모델을 호출한 횟수
);

-- 사용량 인덱스 (일별 집계가 주 질의라 occurred_at 우선)
CREATE INDEX IF NOT EXISTS idx_ai_usage_occurred ON ai_usage_records(occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_project ON ai_usage_records(project_id, occurred_at);
"#;
