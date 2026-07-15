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
    snapshot_json TEXT,
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
    confluence_search_enabled INTEGER NOT NULL DEFAULT 1,
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

-- 품질 장부: 파이프라인이 만든 모든 지적·수정·판정 (설계서 §4.1 quality_record)
-- 하이브리드 저장: KPI 쿼리(§7.3)에 쓰는 필드는 평탄 컬럼, 나머지 중첩 객체는 JSON blob.
-- 필드명/값 어휘는 설계서 §4 계약이며 코드가 바뀌어도 유지한다.
CREATE TABLE IF NOT EXISTS quality_records (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    -- 작업 맥락 (nullable)
    doc_ref TEXT,
    route_id TEXT,
    direction TEXT,
    content_type TEXT,
    -- KPI 집계용 평탄 컬럼 (origin/finding/disposition에서 승격)
    stage TEXT,                       -- origin.stage
    caught_by TEXT,                   -- origin.caught_by
    executor TEXT,                    -- origin.executor (app | claude_agent | human)
    producer_model TEXT,              -- origin.producer_model
    reviewer_model TEXT,              -- origin.reviewer_model
    finding_type TEXT,                -- finding.type (통합 어휘 §4.2)
    severity TEXT,                    -- finding.severity (critical | major | minor)
    disposition TEXT,                 -- proposed | accepted | rejected | superseded
    promotion_status TEXT,            -- promotion.status
    matched_rule TEXT,                -- promotion.matched_rule
    -- 나머지 상세는 JSON blob (재현/few-shot 재료)
    segment_json TEXT,                -- { source, output, corrected, context }
    finding_json TEXT,                -- { type, severity, description, suggested_fix }
    origin_json TEXT,                 -- { stage, caught_by, executor, producer_model, reviewer_model }
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 품질 장부 인덱스 (KPI 집계·필터 조회용)
CREATE INDEX IF NOT EXISTS idx_quality_records_project ON quality_records(project_id);
CREATE INDEX IF NOT EXISTS idx_quality_records_created ON quality_records(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quality_records_stage ON quality_records(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_quality_records_disposition ON quality_records(project_id, disposition);

-- 작업 기록: 스테이지 실행 1회 = 1행. 레코드의 분모 (설계서 §4.4 quality_run)
CREATE TABLE IF NOT EXISTS quality_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    stage TEXT NOT NULL,
    executor TEXT,                    -- app | claude_agent
    model TEXT,
    direction TEXT,
    route_id TEXT,
    doc_words INTEGER,                -- 대상 텍스트 단어 수 (KPI 분모)
    findings_count_json TEXT,         -- { critical, major, minor }
    notes TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 작업 기록 인덱스
CREATE INDEX IF NOT EXISTS idx_quality_runs_project ON quality_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_quality_runs_started ON quality_runs(project_id, started_at);
"#;
