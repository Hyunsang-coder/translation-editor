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
CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    description TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    chat_summary TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 히스토리 인덱스
CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);

-- 채팅 세션 테이블
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    context_block_ids TEXT NOT NULL,  -- JSON Array
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

-- 용어집 테이블
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

-- 용어집 인덱스
CREATE INDEX IF NOT EXISTS idx_glossary_project ON glossary_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_glossary_source ON glossary_entries(source);
"#;

