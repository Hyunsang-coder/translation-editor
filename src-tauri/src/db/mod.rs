//! Database Module
//!
//! SQLite 데이터베이스 관리

mod schema;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use rusqlite::backup::Backup;

use crate::error::IteError;
use crate::models::{ChatSession, EditorBlock, IteProject, SegmentGroup};

#[derive(Debug, Clone)]
pub struct GlossaryEntryRow {
    pub id: String,
    pub source: String,
    pub target: String,
    pub notes: Option<String>,
    pub domain: Option<String>,
    pub case_sensitive: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct RecentProjectRow {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct McpServerRow {
    pub id: String,
    pub name: String,
    pub server_type: String,
    pub config_json: String,
    pub is_enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 데이터베이스 상태 (Tauri 앱 상태로 관리)
pub struct DbState(pub Mutex<Database>);

/// 데이터베이스 래퍼
pub struct Database {
    conn: Connection,
}

impl Database {
    /// 새 데이터베이스 연결 생성
    pub fn new(path: &Path) -> Result<Self, IteError> {
        let conn = Connection::open(path)?;
        // WAL 모드: 동시 읽기/쓰기 성능 향상, 크래시 복구 개선
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // SQLite는 기본적으로 foreign_keys가 OFF일 수 있어, ON DELETE CASCADE가 동작하지 않을 수 있습니다.
        // (프로젝트 삭제/정리 안정성을 위해 명시적으로 활성화)
        conn.pragma_update(None, "foreign_keys", true)?;
        Ok(Self { conn })
    }

    /// 데이터베이스 스키마 초기화
    pub fn initialize(&self) -> Result<(), IteError> {
        self.conn.execute_batch(schema::CREATE_SCHEMA)?;
        self.run_migrations()?;
        Ok(())
    }

    /// 기존 DB에 누락된 컬럼을 추가하는 마이그레이션
    fn run_migrations(&self) -> Result<(), IteError> {
        // chat_sessions.confluence_search_enabled 컬럼 추가 (기존 DB 호환)
        let has_column: bool = self
            .conn
            .prepare("SELECT confluence_search_enabled FROM chat_sessions LIMIT 0")
            .is_ok();
        if !has_column {
            self.conn.execute_batch(
                "ALTER TABLE chat_sessions ADD COLUMN confluence_search_enabled INTEGER NOT NULL DEFAULT 1;"
            )?;
        }
        Ok(())
    }

    /// 현재 DB를 파일로 내보내기(.ite: SQLite DB 파일)
    pub fn export_db_to_file(&self, out_path: &Path) -> Result<(), IteError> {
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // 백업 수행은 scope로 감싸 out_conn을 확실히 drop(=flush) 한 뒤 파일 크기 검증을 합니다.
        // (일부 환경에선 connection이 살아있는 동안 metadata.len()이 0으로 보일 수 있음)
        {
            let mut out_conn = Connection::open(out_path)?;
            // 스키마가 없어도 백업이 전체 DB를 복제하지만,
            // 일부 환경에서의 안정성을 위해 명시적으로 초기화합니다.
            out_conn.execute_batch(schema::CREATE_SCHEMA)?;

            let backup = Backup::new(&self.conn, &mut out_conn)?;
            backup.run_to_completion(5, std::time::Duration::from_millis(10), None)?;
        } // out_conn drop

        // “성공처럼 보이지만 파일이 실제로 생성되지 않음/0 byte” 케이스 방지용 검증
        let meta = std::fs::metadata(out_path)?;
        if meta.len() == 0 {
            return Err(IteError::InvalidOperation(format!(
                "Export produced an empty file (size=0): {}",
                out_path.display()
            )));
        }
        Ok(())
    }

    /// 프로젝트 삭제(연관 데이터 포함)
    /// - foreign_keys=ON이면 CASCADE로도 처리되지만, 환경 차이를 고려해 명시적으로 정리합니다.
    pub fn delete_project(&self, project_id: &str) -> Result<(), IteError> {
        let tx = self.conn.unchecked_transaction()?;

        // chat_messages -> chat_sessions 순으로 제거(세션 FK)
        tx.execute(
            "DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE project_id = ?1)",
            [project_id],
        )?;
        tx.execute("DELETE FROM chat_sessions WHERE project_id = ?1", [project_id])?;
        tx.execute(
            "DELETE FROM chat_project_settings WHERE project_id = ?1",
            [project_id],
        )?;

        tx.execute("DELETE FROM history WHERE project_id = ?1", [project_id])?;
        tx.execute("DELETE FROM glossary_entries WHERE project_id = ?1", [project_id])?;
        tx.execute("DELETE FROM segments WHERE project_id = ?1", [project_id])?;
        tx.execute("DELETE FROM blocks WHERE project_id = ?1", [project_id])?;
        tx.execute("DELETE FROM projects WHERE id = ?1", [project_id])?;

        tx.commit()?;
        Ok(())
    }

    /// 모든 프로젝트 삭제(연관 데이터 포함)
    /// - 전역 용어집(project_id IS NULL)은 유지합니다.
    pub fn delete_all_projects(&self) -> Result<(), IteError> {
        let tx = self.conn.unchecked_transaction()?;

        tx.execute("DELETE FROM chat_messages", [])?;
        tx.execute("DELETE FROM chat_sessions", [])?;
        tx.execute("DELETE FROM chat_project_settings", [])?;
        tx.execute("DELETE FROM history", [])?;
        tx.execute("DELETE FROM glossary_entries WHERE project_id IS NOT NULL", [])?;
        tx.execute("DELETE FROM segments", [])?;
        tx.execute("DELETE FROM blocks", [])?;
        tx.execute("DELETE FROM projects", [])?;

        tx.commit()?;
        Ok(())
    }

    /// 파일(.ite)을 현재 DB로 가져오기 (현재 DB 내용을 덮어씀)
    pub fn import_db_from_file(&mut self, in_path: &Path) -> Result<(), IteError> {
        let in_conn = Connection::open(in_path)?;

        // 현재 연결을 새 DB 파일로 덮어쓰기(backup)
        let backup = Backup::new(&in_conn, &mut self.conn)?;
        backup.run_to_completion(5, std::time::Duration::from_millis(10), None)?;
        Ok(())
    }

    /// 저장된 프로젝트 ID 목록 조회
    pub fn list_project_ids(&self) -> Result<Vec<String>, IteError> {
        let mut stmt = self.conn.prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1000")?;
        let iter = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for id in iter {
            ids.push(id?);
        }
        Ok(ids)
    }

    /// 최근 프로젝트 목록(간단 메타 포함)
    pub fn list_recent_projects(&self, limit: usize) -> Result<Vec<RecentProjectRow>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, metadata_json, updated_at FROM projects ORDER BY updated_at DESC LIMIT ?1",
        )?;

        let iter = stmt.query_map([limit as i64], |row| {
            let id: String = row.get(0)?;
            let metadata_json: String = row.get(1)?;
            let updated_at: i64 = row.get(2)?;

            // metadata_json에서 title만 안전하게 추출
            let title = serde_json::from_str::<serde_json::Value>(&metadata_json)
                .ok()
                .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| "Untitled Project".to_string());

            Ok(RecentProjectRow { id, title, updated_at })
        })?;

        let mut out = Vec::new();
        for row in iter {
            out.push(row?);
        }
        Ok(out)
    }

    /// 프로젝트 저장
    pub fn save_project(&self, project: &IteProject) -> Result<(), IteError> {
        let tx = self.conn.unchecked_transaction()?;

        // 프로젝트 메타데이터 저장
        // INSERT OR REPLACE는 row를 삭제후 재생성하므로, CASCADE DELETE가 설정된 자식 테이블(chat_project_settings 등)이
        // 의도치 않게 삭제될 수 있습니다. 이를 방지하기 위해 UPSERT를 사용합니다.
        tx.execute(
            "INSERT INTO projects (id, version, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                version = excluded.version,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at",
            (
                &project.id,
                &project.version,
                serde_json::to_string(&project.metadata)?,
                project.metadata.created_at,
                project.metadata.updated_at,
            ),
        )?;

        // 기존 데이터 삭제
        tx.execute("DELETE FROM blocks WHERE project_id = ?1", [&project.id])?;
        tx.execute("DELETE FROM segments WHERE project_id = ?1", [&project.id])?;

        // 블록 저장
        for (_, block) in &project.blocks {
            tx.execute(
                "INSERT INTO blocks (id, project_id, block_type, content, hash, metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (
                    &block.id,
                    &project.id,
                    &block.block_type,
                    &block.content,
                    &block.hash,
                    serde_json::to_string(&block.metadata)?,
                ),
            )?;
        }

        // 세그먼트 저장
        for segment in &project.segments {
            tx.execute(
                "INSERT INTO segments (id, project_id, source_ids, target_ids, is_aligned, segment_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (
                    &segment.group_id,
                    &project.id,
                    serde_json::to_string(&segment.source_ids)?,
                    serde_json::to_string(&segment.target_ids)?,
                    segment.is_aligned,
                    segment.order,
                ),
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// 현재 채팅 세션(1개)을 프로젝트에 저장
    /// - 요구사항: 프로젝트별 "현재 세션 1개만" 저장
    pub fn save_current_chat_session(
        &self,
        project_id: &str,
        session: &ChatSession,
    ) -> Result<(), IteError> {
        // 레거시 호환: "현재 세션 1개" 저장 API는 여전히 유지하되,
        // 내부적으로는 다중 세션 저장 로직을 호출하여 구현을 단일화합니다.
        self.save_chat_sessions(project_id, std::slice::from_ref(session))
    }

    /// 채팅 세션을 프로젝트에 저장 (최대 5개 유지)
    /// - 정책: 최근 활동(마지막 메시지 timestamp) 기준으로 정렬 후 상위 5개만 저장
    /// - 세션당 메시지는 최근 30개만 저장 (스토리지 부담 방지)
    pub fn save_chat_sessions(
        &self,
        project_id: &str,
        sessions: &[ChatSession],
    ) -> Result<(), IteError> {
        let tx = self.conn.unchecked_transaction()?;

        // 기존 세션/메시지 제거(프로젝트당 1개만 유지)
        tx.execute(
            "DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE project_id = ?1)",
            [project_id],
        )?;
        tx.execute("DELETE FROM chat_sessions WHERE project_id = ?1", [project_id])?;

        // 최근 활동 기준으로 정렬 후 최대 5개만 저장
        let mut sorted: Vec<&ChatSession> = sessions.iter().collect();
        sorted.sort_by(|a, b| {
            let a_last = a
                .messages
                .iter()
                .map(|m| m.timestamp)
                .max()
                .unwrap_or(a.created_at);
            let b_last = b
                .messages
                .iter()
                .map(|m| m.timestamp)
                .max()
                .unwrap_or(b.created_at);
            b_last.cmp(&a_last)
        });

        const MAX_SESSIONS: usize = 5;
        const MAX_MESSAGES_PER_SESSION: usize = 100;

        for session in sorted.into_iter().take(MAX_SESSIONS) {
            tx.execute(
                "INSERT INTO chat_sessions (id, project_id, name, created_at, context_block_ids, confluence_search_enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (
                    &session.id,
                    project_id,
                    &session.name,
                    session.created_at,
                    serde_json::to_string(&session.context_block_ids)?,
                    session.confluence_search_enabled,
                ),
            )?;

            // 메시지를 timestamp 기준으로 정렬 후 최근 MAX_MESSAGES_PER_SESSION개만 저장
            let mut messages: Vec<&crate::models::ChatMessage> = session.messages.iter().collect();
            messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            let messages_to_save = if messages.len() > MAX_MESSAGES_PER_SESSION {
                &messages[messages.len() - MAX_MESSAGES_PER_SESSION..]
            } else {
                &messages[..]
            };

            for m in messages_to_save {
                let meta_json: Option<String> = match &m.metadata {
                    Some(meta) => Some(serde_json::to_string(meta)?),
                    None => None,
                };
                tx.execute(
                    "INSERT INTO chat_messages (id, session_id, role, content, timestamp, metadata_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    (
                        &m.id,
                        &session.id,
                        &m.role,
                        &m.content,
                        m.timestamp,
                        meta_json,
                    ),
                )?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    /// 현재 채팅 세션(1개) 로드
    pub fn load_current_chat_session(&self, project_id: &str) -> Result<Option<ChatSession>, IteError> {
        // 레거시 API: 가장 최근 활동 세션 1개만 반환
        let sessions = self.load_chat_sessions(project_id)?;
        Ok(sessions.into_iter().next())
    }

    /// 채팅 세션 목록 로드 (최근 활동 기준, 최대 MAX_SESSIONS개)
    pub fn load_chat_sessions(&self, project_id: &str) -> Result<Vec<ChatSession>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.name, s.created_at, s.context_block_ids, s.confluence_search_enabled,
                    COALESCE((SELECT MAX(m.timestamp) FROM chat_messages m WHERE m.session_id = s.id), s.created_at) AS last_ts
             FROM chat_sessions s
             WHERE s.project_id = ?1
             ORDER BY last_ts DESC
             LIMIT 5",
        )?;

        let iter = stmt.query_map([project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?;

        let mut sessions = Vec::new();
        for r in iter {
            let (session_id, name, created_at, context_block_ids_json, confluence_search_enabled) = r?;
            let context_block_ids: Vec<String> =
                serde_json::from_str(&context_block_ids_json).unwrap_or_default();

            let mut msg_stmt = self.conn.prepare(
                "SELECT id, role, content, timestamp, metadata_json
                 FROM chat_messages WHERE session_id = ?1
                 ORDER BY timestamp ASC",
            )?;

            let msg_iter = msg_stmt.query_map([&session_id], |row| {
                let metadata_json: Option<String> = row.get(4)?;
                let metadata: Option<serde_json::Value> = metadata_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());
                Ok(crate::models::ChatMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get(3)?,
                    metadata,
                })
            })?;

            let mut messages = Vec::new();
            for m in msg_iter {
                messages.push(m?);
            }

            sessions.push(ChatSession {
                id: session_id,
                name,
                created_at,
                messages,
                context_block_ids,
                confluence_search_enabled,
            });
        }

        Ok(sessions)
    }

    /// 프로젝트별 채팅 설정 저장(JSON)
    pub fn save_chat_project_settings(
        &self,
        project_id: &str,
        settings_json: &str,
        updated_at: i64,
    ) -> Result<(), IteError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO chat_project_settings (project_id, settings_json, updated_at)
             VALUES (?1, ?2, ?3)",
            (project_id, settings_json, updated_at),
        )?;
        Ok(())
    }

    /// 프로젝트별 채팅 설정 로드(JSON)
    pub fn load_chat_project_settings(&self, project_id: &str) -> Result<Option<String>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT settings_json FROM chat_project_settings WHERE project_id = ?1",
        )?;
        let row = stmt.query_row([project_id], |row| row.get::<_, String>(0));
        match row {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(IteError::Database(e)),
        }
    }

    /// 프로젝트 로드
    pub fn load_project(&self, project_id: &str) -> Result<IteProject, IteError> {
        // 프로젝트 메타데이터 로드
        let mut stmt = self.conn.prepare(
            "SELECT id, version, metadata_json FROM projects WHERE id = ?1",
        )?;

        let (id, version, metadata_json): (String, String, String) = stmt
            .query_row([project_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|_| IteError::ProjectNotFound(project_id.to_string()))?;

        let metadata = serde_json::from_str(&metadata_json)?;

        // 블록 로드
        let mut blocks = std::collections::HashMap::new();
        let mut block_stmt = self.conn.prepare(
            "SELECT id, block_type, content, hash, metadata_json FROM blocks WHERE project_id = ?1",
        )?;

        let block_iter = block_stmt.query_map([project_id], |row| {
            let metadata_json: String = row.get(4)?;
            Ok(EditorBlock {
                id: row.get(0)?,
                block_type: row.get(1)?,
                content: row.get(2)?,
                hash: row.get(3)?,
                metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
            })
        })?;

        for block in block_iter {
            let block = block?;
            blocks.insert(block.id.clone(), block);
        }

        // 세그먼트 로드
        let mut segments = Vec::new();
        let mut segment_stmt = self.conn.prepare(
            "SELECT id, source_ids, target_ids, is_aligned, segment_order 
             FROM segments WHERE project_id = ?1 ORDER BY segment_order",
        )?;

        let segment_iter = segment_stmt.query_map([project_id], |row| {
            let source_ids_json: String = row.get(1)?;
            let target_ids_json: String = row.get(2)?;
            Ok(SegmentGroup {
                group_id: row.get(0)?,
                source_ids: serde_json::from_str(&source_ids_json).unwrap_or_default(),
                target_ids: serde_json::from_str(&target_ids_json).unwrap_or_default(),
                is_aligned: row.get(3)?,
                order: row.get(4)?,
            })
        })?;

        for segment in segment_iter {
            segments.push(segment?);
        }

        Ok(IteProject {
            id,
            version,
            metadata,
            segments,
            blocks,
            history: Vec::new(), // TODO: 히스토리 로드 구현
        })
    }

    /// 블록 업데이트
    pub fn update_block(&self, block: &EditorBlock, project_id: &str) -> Result<(), IteError> {
        self.conn.execute(
            "UPDATE blocks SET content = ?1, hash = ?2, metadata_json = ?3 
             WHERE id = ?4 AND project_id = ?5",
            (
                &block.content,
                &block.hash,
                serde_json::to_string(&block.metadata)?,
                &block.id,
                project_id,
            ),
        )?;
        Ok(())
    }

    /// 블록 조회
    pub fn get_block(&self, block_id: &str, project_id: &str) -> Result<EditorBlock, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, block_type, content, hash, metadata_json 
             FROM blocks WHERE id = ?1 AND project_id = ?2",
        )?;

        stmt.query_row([block_id, project_id], |row| {
            let metadata_json: String = row.get(4)?;
            Ok(EditorBlock {
                id: row.get(0)?,
                block_type: row.get(1)?,
                content: row.get(2)?,
                hash: row.get(3)?,
                metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
            })
        })
        .map_err(|_| IteError::BlockNotFound(block_id.to_string()))
    }

    /// CSV 글로서리 임포트(project scope)
    /// - replace=true면 해당 프로젝트 scope 엔트리를 전부 지우고 다시 넣음
    ///
    /// # Safety
    /// `path`는 호출자(commands/glossary.rs)에서 `validate_path()`로 검증된 경로여야 함.
    pub fn import_glossary_csv(
        &mut self,
        project_id: &str,
        path: &str,
        replace_project_scope: bool,
    ) -> Result<(u32, u32, u32), IteError> {
        // ────────────────────────────────────────────────────────────────────
        // Phase 1: Read and parse OUTSIDE transaction
        // ────────────────────────────────────────────────────────────────────
        let text = std::fs::read_to_string(path)?;

        // 간단 CSV 파서(외부 크레이트 없이 동작)
        // - 기본: UTF-8 CSV
        // - 따옴표(") 내부의 콤마는 필드로 취급
        // - "" 는 " 로 이스케이프
        fn parse_csv_row(line: &str) -> Vec<String> {
            let mut out: Vec<String> = Vec::new();
            let mut cur = String::new();
            let mut in_quotes = false;
            let mut it = line.chars().peekable();
            while let Some(ch) = it.next() {
                match ch {
                    '"' => {
                        if in_quotes {
                            if matches!(it.peek(), Some('"')) {
                                cur.push('"');
                                it.next();
                            } else {
                                in_quotes = false;
                            }
                        } else {
                            in_quotes = true;
                        }
                    }
                    ',' if !in_quotes => {
                        out.push(cur.trim().to_string());
                        cur.clear();
                    }
                    _ => cur.push(ch),
                }
            }
            out.push(cur.trim().to_string());
            out
        }

        // 유효 라인들만 파싱
        let mut rows: Vec<Vec<String>> = Vec::new();
        for line in text.lines() {
            let l = line.trim_end_matches('\r').trim();
            if l.is_empty() || l.starts_with('#') {
                continue;
            }
            rows.push(parse_csv_row(l));
        }

        if rows.is_empty() {
            return Ok((0, 0, 0));
        }

        // 헤더 여부 판단
        let first = &rows[0];
        let lower = first
            .iter()
            .map(|c| c.trim().to_lowercase())
            .collect::<Vec<_>>();

        let _has_source = lower.iter().any(|c| c == "source");
        let _has_target = lower.iter().any(|c| c == "target");

        // "A언어 칼럼 | B언어 칼럼" 구조만 지켜지면 OK.
        // 즉, headers가 있든 없든 2개 이상의 칼럼이 있으면 0, 1번을 사용.
        // 다만 헤더 '줄'이 있다고 가정하고 첫 줄을 헤더로 소비할지 말지가 관건인데,
        // 사용자 요청 "헤더 + A | B 구조"라고 했으므로 무조건 첫 줄은 헤더로 간주하고 건너뜀.
        let (headers, data_rows) = (first.clone(), &rows[1..]);

        let find_idx = |name: &str| -> Option<usize> {
            let needle = name.to_lowercase();
            headers
                .iter()
                .position(|h| h.trim().to_lowercase() == needle)
        };

        // Source/Target 컬럼 찾기 시도, 없으면 0번, 1번 인덱스 사용
        let idx_source = find_idx("source").unwrap_or(0);
        let idx_target = find_idx("target").unwrap_or(1);
        let idx_notes = find_idx("notes");
        let idx_domain = find_idx("domain");
        let idx_case = find_idx("casesensitive").or_else(|| find_idx("case_sensitive"));

        // Pre-parse all records into a structured Vec (outside transaction)
        // (id, source, target, notes, domain, case_sensitive)
        struct ParsedRecord {
            id: String,
            source: String,
            target: String,
            notes: Option<String>,
            domain: Option<String>,
            case_sensitive: bool,
        }

        let mut parsed_records: Vec<ParsedRecord> = Vec::with_capacity(data_rows.len());
        let mut skipped: u32 = 0;

        for record in data_rows {
            let source = record.get(idx_source).map(|s| s.trim()).unwrap_or("");
            let target = record.get(idx_target).map(|s| s.trim()).unwrap_or("");

            if source.is_empty() || target.is_empty() {
                skipped += 1;
                continue;
            }

            let notes = idx_notes
                .and_then(|i| record.get(i))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let domain = idx_domain
                .and_then(|i| record.get(i))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let case_sensitive = idx_case
                .and_then(|i| record.get(i))
                .map(|s| s.trim().to_lowercase())
                .map(|v| v == "1" || v == "true" || v == "yes" || v == "y")
                .unwrap_or(false);

            let id = format!(
                "{:x}",
                md5::compute(format!("{}|{}|{}", project_id, source, target))
            );

            parsed_records.push(ParsedRecord {
                id,
                source: source.to_string(),
                target: target.to_string(),
                notes,
                domain,
                case_sensitive,
            });
        }

        // ────────────────────────────────────────────────────────────────────
        // Phase 2: Batch insert WITH transaction per batch
        // ────────────────────────────────────────────────────────────────────
        const BATCH_SIZE: usize = 500;
        let mut inserted: u32 = 0;
        let mut updated: u32 = 0;

        // Handle replace_project_scope in its own transaction first
        if replace_project_scope {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute(
                "DELETE FROM glossary_entries WHERE project_id = ?1",
                [project_id],
            )?;
            tx.commit()?;
        }

        let now = chrono::Utc::now().timestamp_millis();

        for chunk in parsed_records.chunks(BATCH_SIZE) {
            let tx = self.conn.unchecked_transaction()?;

            for rec in chunk {
                // 존재 여부 확인(INSERT vs UPDATE 카운트용)
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM glossary_entries WHERE id = ?1)",
                        [&rec.id],
                        |row| row.get::<_, i64>(0).map(|v| v == 1),
                    )
                    .unwrap_or(false);

                // upsert (created_at은 기존 유지)
                tx.execute(
                    "INSERT INTO glossary_entries (
                        id, project_id, source, target, notes, domain, case_sensitive, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(id) DO UPDATE SET
                        project_id = excluded.project_id,
                        source = excluded.source,
                        target = excluded.target,
                        notes = excluded.notes,
                        domain = excluded.domain,
                        case_sensitive = excluded.case_sensitive,
                        updated_at = excluded.updated_at",
                    (
                        &rec.id,
                        project_id,
                        &rec.source,
                        &rec.target,
                        rec.notes.as_deref(),
                        rec.domain.as_deref(),
                        if rec.case_sensitive { 1 } else { 0 },
                        now,
                        now,
                    ),
                )?;

                if exists {
                    updated += 1;
                } else {
                    inserted += 1;
                }
            }

            tx.commit()?;
        }

        Ok((inserted, updated, skipped))
    }

    /// query 문자열 안에 등장하는 source 용어를 찾아 상위 N개를 반환합니다.
    /// - case_sensitive=1: query에서 그대로 포함 여부 검사
    /// - case_sensitive=0: lower(query)에서 lower(source) 포함 여부 검사
    pub fn search_glossary_in_text(
        &self,
        project_id: &str,
        query: &str,
        domain: Option<&str>,
        limit: u32,
    ) -> Result<Vec<GlossaryEntryRow>, IteError> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, source, target, notes, domain, case_sensitive, created_at, updated_at
             FROM glossary_entries
             WHERE (project_id IS NULL OR project_id = ?1)
               AND (?2 IS NULL OR domain IS NULL OR domain = ?2)
               AND (
                    (case_sensitive = 1 AND instr(?3, source) > 0)
                 OR (case_sensitive = 0 AND instr(lower(?3), lower(source)) > 0)
               )
             ORDER BY length(source) DESC
             LIMIT ?4",
        )?;

        let iter = stmt.query_map(
            (project_id, domain, q, limit as i64),
            |row| {
                Ok(GlossaryEntryRow {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    target: row.get(2)?,
                    notes: row.get(3)?,
                    domain: row.get(4)?,
                    case_sensitive: {
                        let v: i64 = row.get(5)?;
                        v == 1
                    },
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )?;

        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// Excel(.xlsx/.xls) 글로서리 임포트(project scope)
    /// - 첫 번째 시트(또는 첫 sheet_names())를 읽습니다.
    /// - 첫 행이 source/target 헤더로 보이면 헤더로 취급합니다.
    ///
    /// # Safety
    /// `path`는 호출자(commands/glossary.rs)에서 `validate_path()`로 검증된 경로여야 함.
    pub fn import_glossary_excel(
        &mut self,
        project_id: &str,
        path: &str,
        replace_project_scope: bool,
    ) -> Result<(u32, u32, u32), IteError> {
        use calamine::{open_workbook_auto, Data, Reader};

        let now = chrono::Utc::now().timestamp_millis();
        let tx = self.conn.unchecked_transaction()?;

        if replace_project_scope {
            tx.execute(
                "DELETE FROM glossary_entries WHERE project_id = ?1",
                [project_id],
            )?;
        }

        let mut workbook =
            open_workbook_auto(path).map_err(|e| IteError::InvalidOperation(format!("{}", e)))?;
        let sheet_names = workbook.sheet_names().to_owned();
        let first_sheet = sheet_names
            .get(0)
            .ok_or_else(|| IteError::InvalidOperation("Excel에 시트가 없습니다.".to_string()))?
            .to_string();

        let range = workbook
            .worksheet_range(&first_sheet)
            .map_err(|e| IteError::InvalidOperation(format!("{}", e)))?;

        fn cell_to_string(c: &Data) -> String {
            match c {
                Data::Empty => String::new(),
                _ => c.to_string().trim().to_string(),
            }
        }

        let mut rows: Vec<Vec<String>> = Vec::new();
        for row in range.rows() {
            let cols = row.iter().map(cell_to_string).collect::<Vec<String>>();
            // 완전 공백 행은 스킵
            if cols.iter().all(|c: &String| c.trim().is_empty()) {
                continue;
            }
            rows.push(cols);
        }

        if rows.is_empty() {
            return Ok((0, 0, 0));
        }

        // 헤더 여부 판단
        let first = &rows[0];

        // Excel도 CSV와 동일하게 무조건 첫 줄은 헤더라고 가정하고 시작
        let (headers, data_rows) = (first.clone(), &rows[1..]);

        let find_idx = |name: &str| -> Option<usize> {
            let needle = name.to_lowercase();
            headers
                .iter()
                .position(|h| h.trim().to_lowercase() == needle)
        };

        // Source/Target 컬럼 찾기 시도, 없으면 0번, 1번 인덱스 사용
        let idx_source = find_idx("source").unwrap_or(0);
        let idx_target = find_idx("target").unwrap_or(1);
        let idx_notes = find_idx("notes");
        let idx_domain = find_idx("domain");
        let idx_case = find_idx("casesensitive").or_else(|| find_idx("case_sensitive"));

        let mut inserted: u32 = 0;
        let mut updated: u32 = 0;
        let mut skipped: u32 = 0;

        for record in data_rows {
            let source = record.get(idx_source).map(|s| s.trim()).unwrap_or("");
            let target = record.get(idx_target).map(|s| s.trim()).unwrap_or("");
            if source.is_empty() || target.is_empty() {
                skipped += 1;
                continue;
            }

            let notes = idx_notes
                .and_then(|i| record.get(i))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let domain = idx_domain
                .and_then(|i| record.get(i))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let case_sensitive = idx_case
                .and_then(|i| record.get(i))
                .map(|s| s.trim().to_lowercase())
                .map(|v| v == "1" || v == "true" || v == "yes" || v == "y")
                .unwrap_or(false);

            let id = format!(
                "{:x}",
                md5::compute(format!("{}|{}|{}", project_id, source, target))
            );

            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM glossary_entries WHERE id = ?1)",
                    [&id],
                    |row| row.get::<_, i64>(0).map(|v| v == 1),
                )
                .unwrap_or(false);

            tx.execute(
                "INSERT INTO glossary_entries (
                    id, project_id, source, target, notes, domain, case_sensitive, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    source = excluded.source,
                    target = excluded.target,
                    notes = excluded.notes,
                    domain = excluded.domain,
                    case_sensitive = excluded.case_sensitive,
                    updated_at = excluded.updated_at",
                (
                    &id,
                    project_id,
                    source,
                    target,
                    notes.as_deref(),
                    domain.as_deref(),
                    if case_sensitive { 1 } else { 0 },
                    now,
                    now,
                ),
            )?;

            if exists {
                updated += 1;
            } else {
                inserted += 1;
            }
        }

        tx.commit()?;
        Ok((inserted, updated, skipped))
    }

    /// 첨부 파일 저장
    pub fn save_attachment(&self, a: &crate::models::Attachment) -> Result<(), IteError> {
        self.conn.execute(
            "INSERT INTO attachments (
                id, project_id, filename, file_type, file_path, extracted_text, file_size, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                filename = excluded.filename,
                file_type = excluded.file_type,
                file_path = excluded.file_path,
                extracted_text = excluded.extracted_text,
                file_size = excluded.file_size,
                updated_at = excluded.updated_at",
            (
                &a.id,
                &a.project_id,
                &a.filename,
                &a.file_type,
                &a.file_path,
                &a.extracted_text,
                a.file_size,
                a.created_at,
                a.updated_at,
            ),
        )?;
        Ok(())
    }

    /// 프로젝트별 첨부 파일 목록 조회
    pub fn list_attachments(&self, project_id: &str) -> Result<Vec<crate::models::Attachment>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, filename, file_type, file_path, extracted_text, file_size, created_at, updated_at
             FROM attachments WHERE project_id = ?1 ORDER BY created_at ASC",
        )?;

        let iter = stmt.query_map([project_id], |row| {
            Ok(crate::models::Attachment {
                id: row.get(0)?,
                project_id: row.get(1)?,
                filename: row.get(2)?,
                file_type: row.get(3)?,
                file_path: row.get(4)?,
                extracted_text: row.get(5)?,
                file_size: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// 첨부 파일 삭제
    pub fn delete_attachment(&self, id: &str) -> Result<(), IteError> {
        self.conn.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
        Ok(())
    }

    /// MCP 서버 저장 (Insert or Update)
    pub fn save_mcp_server(&self, server: &McpServerRow) -> Result<(), IteError> {
        self.conn.execute(
            "INSERT INTO mcp_servers (
                id, name, server_type, config_json, is_enabled, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                server_type = excluded.server_type,
                config_json = excluded.config_json,
                is_enabled = excluded.is_enabled,
                updated_at = excluded.updated_at",
            (
                &server.id,
                &server.name,
                &server.server_type,
                &server.config_json,
                if server.is_enabled { 1 } else { 0 },
                server.created_at,
                server.updated_at,
            ),
        )?;
        Ok(())
    }

    /// MCP 서버 목록 조회
    pub fn list_mcp_servers(&self) -> Result<Vec<McpServerRow>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, server_type, config_json, is_enabled, created_at, updated_at
             FROM mcp_servers ORDER BY created_at ASC",
        )?;

        let iter = stmt.query_map([], |row| {
            let is_enabled: i64 = row.get(4)?;
            Ok(McpServerRow {
                id: row.get(0)?,
                name: row.get(1)?,
                server_type: row.get(2)?,
                config_json: row.get(3)?,
                is_enabled: is_enabled == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// MCP 서버 삭제
    pub fn delete_mcp_server(&self, id: &str) -> Result<(), IteError> {
        self.conn.execute("DELETE FROM mcp_servers WHERE id = ?1", [id])?;
        Ok(())
    }
}

impl Default for crate::models::BlockMetadata {
    fn default() -> Self {
        Self {
            author: None,
            created_at: chrono::Utc::now().timestamp_millis(),
            updated_at: chrono::Utc::now().timestamp_millis(),
            tags: Vec::new(),
            comments: None,
        }
    }
}
