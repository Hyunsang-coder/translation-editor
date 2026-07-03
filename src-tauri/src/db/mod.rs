//! Database Module
//!
//! SQLite 데이터베이스 관리

mod schema;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::backup::Backup;
use rusqlite::Connection;
use rusqlite::OptionalExtension;

use crate::error::IteError;
use crate::models::{
    ChatSession, EditorBlock, HistorySnapshot, HistorySnapshotMeta, IteProject, SegmentGroup,
};

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
#[serde(rename_all = "camelCase")]
pub struct CommentRow {
    pub id: String,
    pub field: String,
    pub segment_group_id: Option<String>,
    pub excerpt: String,
    pub comment: String,
    pub resolved: bool,
    pub created_at: i64,
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

/// 품질 장부 레코드 (설계서 §4.1). 하이브리드 저장:
/// KPI 쿼리용 필드는 평탄 컬럼, 상세 중첩 객체는 JSON 문자열 그대로 보관.
/// `*_json` 필드는 프론트가 직렬화한 §4.1 하위 객체를 그대로 통과시킨다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityRecordRow {
    pub id: String,
    pub created_at: i64,
    // 작업 맥락 (nullable)
    pub doc_ref: Option<String>,
    pub route_id: Option<String>,
    pub direction: Option<String>,
    pub content_type: Option<String>,
    // KPI 집계용 평탄 컬럼
    pub stage: Option<String>,
    pub caught_by: Option<String>,
    pub executor: Option<String>,
    pub producer_model: Option<String>,
    pub reviewer_model: Option<String>,
    pub finding_type: Option<String>,
    pub severity: Option<String>,
    pub disposition: Option<String>,
    pub promotion_status: Option<String>,
    pub matched_rule: Option<String>,
    // 상세 JSON blob
    pub segment_json: Option<String>,
    pub finding_json: Option<String>,
    pub origin_json: Option<String>,
}

/// 품질 장부 작업 기록 (설계서 §4.4). 레코드의 분모.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityRunRow {
    pub id: String,
    pub started_at: i64,
    pub stage: String,
    pub executor: Option<String>,
    pub model: Option<String>,
    pub direction: Option<String>,
    pub route_id: Option<String>,
    pub doc_words: Option<i64>,
    pub findings_count_json: Option<String>,
    pub notes: Option<String>,
}

/// 품질 장부 조회 필터 (설계서 §4.7 #2 oddeyes_get_quality_records).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityRecordFilter {
    pub since: Option<i64>,
    pub stage: Option<String>,
    pub disposition: Option<String>,
    pub promotion_status: Option<String>,
    pub limit: Option<i64>,
}

/// Glossary 임포트 공통 검증
fn validate_glossary_rows(
    headers: &[String],
    parsed_count: usize,
    skipped: u32,
    long_entry_count: usize,
) -> Vec<String> {
    let mut warnings = Vec::new();

    let lower_headers: Vec<String> = headers.iter().map(|h| h.trim().to_lowercase()).collect();
    let has_source = lower_headers.iter().any(|h| h == "source");
    let has_target = lower_headers.iter().any(|h| h == "target");

    if !has_source || !has_target {
        warnings.push(
            "Header row does not contain 'Source'/'Target' columns. Using first two columns."
                .to_string(),
        );
    }

    if parsed_count == 0 && skipped > 0 {
        warnings.push("All rows were skipped (empty source or target).".to_string());
    }

    if parsed_count > 0 && long_entry_count * 2 > parsed_count {
        warnings.push(format!(
            "{}% of entries exceed 200 characters. This file may not be a glossary.",
            long_entry_count * 100 / parsed_count
        ));
    }

    warnings
}

/// 데이터베이스 상태 (Tauri 앱 상태로 관리)
pub struct DbState(pub Mutex<Database>);

/// 데이터베이스 래퍼 (commands::AcquireDb trait에서 MutexGuard<Database> 반환용으로 pub)
pub struct Database {
    conn: Connection,
}

impl Database {
    /// 새 데이터베이스 연결 생성
    pub fn new(path: &Path) -> Result<Self, IteError> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.apply_pragmas()?;
        Ok(db)
    }

    /// 커넥션 프래그마 설정
    /// - new() 시 최초 적용
    /// - import_db_from_file() 후 재적용 (backup API가 프래그마를 리셋하므로)
    fn apply_pragmas(&self) -> Result<(), IteError> {
        // WAL 모드: 동시 읽기/쓰기 성능 향상, 크래시 복구 개선
        self.conn.pragma_update(None, "journal_mode", "WAL")?;
        self.conn.pragma_update(None, "synchronous", "NORMAL")?;
        // SQLite는 기본적으로 foreign_keys가 OFF일 수 있어, ON DELETE CASCADE가 동작하지 않을 수 있습니다.
        // (프로젝트 삭제/정리 안정성을 위해 명시적으로 활성화)
        self.conn.pragma_update(None, "foreign_keys", true)?;
        Ok(())
    }

    /// 데이터베이스 스키마 초기화
    /// import 후에도 호출되므로 프래그마도 재적용합니다.
    pub fn initialize(&self) -> Result<(), IteError> {
        self.apply_pragmas()?;
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

        // history.snapshot_json 컬럼 추가 (풀 스냅샷 저장용)
        let has_snapshot_json: bool = self
            .conn
            .prepare("SELECT snapshot_json FROM history LIMIT 0")
            .is_ok();
        if !has_snapshot_json {
            self.conn
                .execute_batch("ALTER TABLE history ADD COLUMN snapshot_json TEXT;")?;
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
        tx.execute(
            "DELETE FROM chat_sessions WHERE project_id = ?1",
            [project_id],
        )?;
        tx.execute(
            "DELETE FROM chat_project_settings WHERE project_id = ?1",
            [project_id],
        )?;

        tx.execute("DELETE FROM history WHERE project_id = ?1", [project_id])?;
        tx.execute(
            "DELETE FROM glossary_entries WHERE project_id = ?1",
            [project_id],
        )?;
        tx.execute(
            "DELETE FROM quality_records WHERE project_id = ?1",
            [project_id],
        )?;
        tx.execute(
            "DELETE FROM quality_runs WHERE project_id = ?1",
            [project_id],
        )?;
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
        tx.execute(
            "DELETE FROM glossary_entries WHERE project_id IS NOT NULL",
            [],
        )?;
        tx.execute("DELETE FROM quality_records", [])?;
        tx.execute("DELETE FROM quality_runs", [])?;
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
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1000")?;
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
                .and_then(|v| {
                    v.get("title")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "Untitled Project".to_string());

            Ok(RecentProjectRow {
                id,
                title,
                updated_at,
            })
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

    /// 히스토리 스냅샷 생성 (풀 blocks JSON 저장)
    pub fn create_history_snapshot(
        &self,
        project_id: &str,
        description: &str,
        snapshot_json: &str,
        chat_summary: Option<&str>,
    ) -> Result<String, IteError> {
        // 저장 시점에 스냅샷 JSON 구조를 검증해, 복원/비교 시점의 지연 실패를 줄인다.
        let _: std::collections::HashMap<String, EditorBlock> =
            serde_json::from_str(snapshot_json)?;

        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "INSERT INTO history (id, project_id, timestamp, description, changes_json, snapshot_json, chat_summary)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                &snapshot_id,
                project_id,
                now,
                description,
                "[]",
                snapshot_json,
                chat_summary,
            ),
        )?;

        self.prune_old_snapshots(project_id, 50)?;
        Ok(snapshot_id)
    }

    /// 히스토리 메타데이터 목록 조회 (최신순, 최대 50개)
    pub fn list_history_metadata(
        &self,
        project_id: &str,
    ) -> Result<Vec<HistorySnapshotMeta>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, timestamp, description, chat_summary
             FROM history
             WHERE project_id = ?1
               AND snapshot_json IS NOT NULL
             ORDER BY timestamp DESC
             LIMIT 50",
        )?;

        let iter = stmt.query_map([project_id], |row| {
            Ok(HistorySnapshotMeta {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                description: row.get(2)?,
                chat_summary: row.get(3)?,
            })
        })?;

        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// 단일 히스토리 스냅샷 조회
    pub fn get_history_snapshot(
        &self,
        snapshot_id: &str,
        project_id: &str,
    ) -> Result<HistorySnapshot, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, timestamp, description, changes_json, chat_summary, snapshot_json
             FROM history
             WHERE id = ?1 AND project_id = ?2",
        )?;

        let row = stmt.query_row([snapshot_id, project_id], |row| {
            let changes_json: String = row.get(3)?;
            let block_changes =
                serde_json::from_str::<Vec<crate::models::BlockChange>>(&changes_json)
                    .unwrap_or_default();

            Ok(HistorySnapshot {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                description: row.get(2)?,
                block_changes,
                chat_summary: row.get(4)?,
                snapshot_json: row.get(5)?,
            })
        });

        match row {
            Ok(snapshot) => Ok(snapshot),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(IteError::InvalidOperation(format!(
                "History snapshot not found: {}",
                snapshot_id
            ))),
            Err(e) => Err(IteError::Database(e)),
        }
    }

    /// 히스토리 스냅샷 삭제
    pub fn delete_history_snapshot(
        &self,
        snapshot_id: &str,
        project_id: &str,
    ) -> Result<(), IteError> {
        let affected = self.conn.execute(
            "DELETE FROM history WHERE id = ?1 AND project_id = ?2",
            [snapshot_id, project_id],
        )?;
        if affected == 0 {
            return Err(IteError::InvalidOperation(format!(
                "History snapshot not found: {}",
                snapshot_id
            )));
        }
        Ok(())
    }

    /// autoSnapshot 덮어쓰기 또는 신규 생성
    /// description = 'autoSnapshot'인 최신 스냅샷이 있으면 content + timestamp를 갱신하고,
    /// 없으면 새로 생성한다. 반환값은 (snapshot_id, created: bool).
    pub fn upsert_auto_snapshot(
        &self,
        project_id: &str,
        description: &str,
        snapshot_json: &str,
        chat_summary: Option<&str>,
    ) -> Result<(String, bool), IteError> {
        // 저장 시점에 스냅샷 JSON 구조를 검증
        let _: std::collections::HashMap<String, EditorBlock> =
            serde_json::from_str(snapshot_json)?;

        let now = chrono::Utc::now().timestamp_millis();

        // 기존 autoSnapshot 조회 (최신 1개)
        let existing_id: Option<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM history
                 WHERE project_id = ?1
                   AND (description = 'autoSnapshot' OR description LIKE '자동 저장%')
                   AND snapshot_json IS NOT NULL
                 ORDER BY timestamp DESC
                 LIMIT 1",
            )?;
            stmt.query_row([project_id], |row| row.get(0)).optional()?
        };

        if let Some(id) = existing_id {
            self.conn.execute(
                "UPDATE history
                 SET snapshot_json = ?1, timestamp = ?2, chat_summary = ?3, description = ?4
                 WHERE id = ?5 AND project_id = ?6",
                (
                    snapshot_json,
                    now,
                    chat_summary,
                    description,
                    &id,
                    project_id,
                ),
            )?;
            Ok((id, false))
        } else {
            let snapshot_id = uuid::Uuid::new_v4().to_string();
            self.conn.execute(
                "INSERT INTO history (id, project_id, timestamp, description, changes_json, snapshot_json, chat_summary)
                 VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6)",
                (&snapshot_id, project_id, now, description, snapshot_json, chat_summary),
            )?;
            Ok((snapshot_id, true))
        }
    }

    /// 히스토리 스냅샷 이름(설명) 변경
    pub fn update_history_snapshot_description(
        &self,
        snapshot_id: &str,
        project_id: &str,
        description: &str,
    ) -> Result<(), IteError> {
        let affected = self.conn.execute(
            "UPDATE history
             SET description = ?1
             WHERE id = ?2 AND project_id = ?3",
            (description, snapshot_id, project_id),
        )?;

        if affected == 0 {
            return Err(IteError::InvalidOperation(format!(
                "History snapshot not found: {}",
                snapshot_id
            )));
        }

        Ok(())
    }

    /// 프로젝트별 오래된 스냅샷 정리
    pub fn prune_old_snapshots(
        &self,
        project_id: &str,
        max_snapshots: usize,
    ) -> Result<(), IteError> {
        self.conn.execute(
            "DELETE FROM history
             WHERE id IN (
               SELECT id FROM history
               WHERE project_id = ?1
                 AND snapshot_json IS NOT NULL
               ORDER BY timestamp DESC
               LIMIT -1 OFFSET ?2
             )
               AND project_id = ?1
               AND snapshot_json IS NOT NULL",
            (project_id, max_snapshots as i64),
        )?;
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
        tx.execute(
            "DELETE FROM chat_sessions WHERE project_id = ?1",
            [project_id],
        )?;

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
    pub fn load_current_chat_session(
        &self,
        project_id: &str,
    ) -> Result<Option<ChatSession>, IteError> {
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
            let (session_id, name, created_at, context_block_ids_json, confluence_search_enabled) =
                r?;
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
        let mut stmt = self
            .conn
            .prepare("SELECT settings_json FROM chat_project_settings WHERE project_id = ?1")?;
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
        let mut stmt = self
            .conn
            .prepare("SELECT id, version, metadata_json FROM projects WHERE id = ?1")?;

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

    /// 블록 삽입
    pub fn insert_block(&self, block: &EditorBlock, project_id: &str) -> Result<(), IteError> {
        self.conn.execute(
            "INSERT INTO blocks (id, project_id, block_type, content, hash, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                &block.id,
                project_id,
                &block.block_type,
                &block.content,
                &block.hash,
                serde_json::to_string(&block.metadata)?,
            ),
        )?;
        Ok(())
    }

    /// 블록 삭제
    pub fn delete_block(&self, block_id: &str, project_id: &str) -> Result<(), IteError> {
        self.conn.execute(
            "DELETE FROM blocks WHERE id = ?1 AND project_id = ?2",
            [block_id, project_id],
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
    ) -> Result<(u32, u32, u32, Vec<String>), IteError> {
        // ────────────────────────────────────────────────────────────────────
        // Phase 1: Read and parse OUTSIDE transaction
        // ────────────────────────────────────────────────────────────────────
        let text = std::fs::read_to_string(path)?;

        // 간단 CSV 파서(외부 크레이트 없이 동작)
        // - 기본: UTF-8 CSV
        // - 따옴표(") 내부의 콤마/줄바꿈은 필드로 취급
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

        // Multi-line CSV 지원: 인용부호 안의 줄바꿈을 하나의 레코드로 결합
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut pending_line = String::new();
        let mut in_quotes = false;
        for line in text.lines() {
            let l = line.trim_end_matches('\r');
            if pending_line.is_empty() {
                let trimmed = l.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
            }

            if !pending_line.is_empty() {
                pending_line.push('\n');
            }
            pending_line.push_str(l);

            // 인용부호 개수를 세어 열린 상태인지 판단
            for ch in l.chars() {
                if ch == '"' {
                    in_quotes = !in_quotes;
                }
            }

            if !in_quotes {
                rows.push(parse_csv_row(&pending_line));
                pending_line.clear();
            }
        }
        // 파일 끝에 닫히지 않은 인용부호가 있으면 남은 줄도 파싱
        if !pending_line.is_empty() {
            rows.push(parse_csv_row(&pending_line));
        }

        if rows.is_empty() {
            return Ok((0, 0, 0, vec![]));
        }

        // 컬럼 수 검증
        if rows[0].len() < 2 {
            return Err(IteError::InvalidOperation(
                "File must have at least 2 columns.".to_string(),
            ));
        }

        // 헤더 여부 판단
        let first = &rows[0];

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
        let mut long_entry_count: usize = 0;

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

            if source.len() > 200 || target.len() > 200 {
                long_entry_count += 1;
            }

            parsed_records.push(ParsedRecord {
                id,
                source: source.to_string(),
                target: target.to_string(),
                notes,
                domain,
                case_sensitive,
            });
        }

        let warnings =
            validate_glossary_rows(&headers, parsed_records.len(), skipped, long_entry_count);

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

        Ok((inserted, updated, skipped, warnings))
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

        let iter = stmt.query_map((project_id, domain, q, limit as i64), |row| {
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
        })?;

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
    ) -> Result<(u32, u32, u32, Vec<String>), IteError> {
        use calamine::{open_workbook_auto, Data, Reader};

        // ────────────────────────────────────────────────────────────────────
        // Phase 1: Read and parse OUTSIDE transaction
        // ────────────────────────────────────────────────────────────────────
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
            return Ok((0, 0, 0, vec![]));
        }

        // 컬럼 수 검증
        if rows[0].len() < 2 {
            return Err(IteError::InvalidOperation(
                "File must have at least 2 columns.".to_string(),
            ));
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

        // Pre-parse all records into a structured Vec (outside transaction)
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
        let mut long_entry_count: usize = 0;

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

            if source.len() > 200 || target.len() > 200 {
                long_entry_count += 1;
            }

            parsed_records.push(ParsedRecord {
                id,
                source: source.to_string(),
                target: target.to_string(),
                notes,
                domain,
                case_sensitive,
            });
        }

        let warnings =
            validate_glossary_rows(&headers, parsed_records.len(), skipped, long_entry_count);

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

        Ok((inserted, updated, skipped, warnings))
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
    pub fn list_attachments(
        &self,
        project_id: &str,
    ) -> Result<Vec<crate::models::Attachment>, IteError> {
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
        self.conn
            .execute("DELETE FROM attachments WHERE id = ?1", [id])?;
        Ok(())
    }

    /// 프로젝트 코멘트 전체 교체 저장 (delete-all + insert)
    pub fn save_comments(
        &mut self,
        project_id: &str,
        comments: &[CommentRow],
    ) -> Result<(), IteError> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM comments WHERE project_id = ?1", [project_id])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO comments (
                    id, project_id, field, segment_group_id, excerpt, comment, resolved, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for c in comments {
                stmt.execute(rusqlite::params![
                    c.id,
                    project_id,
                    c.field,
                    c.segment_group_id,
                    c.excerpt,
                    c.comment,
                    c.resolved as i64,
                    c.created_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 프로젝트별 코멘트 목록 조회
    pub fn load_comments(&self, project_id: &str) -> Result<Vec<CommentRow>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, field, segment_group_id, excerpt, comment, resolved, created_at
             FROM comments WHERE project_id = ?1 ORDER BY created_at ASC",
        )?;

        let iter = stmt.query_map([project_id], |row| {
            Ok(CommentRow {
                id: row.get(0)?,
                field: row.get(1)?,
                segment_group_id: row.get(2)?,
                excerpt: row.get(3)?,
                comment: row.get(4)?,
                resolved: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
            })
        })?;

        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    // ============================================
    // 품질 장부 (Quality Ledger, 설계서 §4)
    // ============================================

    /// 품질 레코드 append 저장 (누적, 교체 아님).
    /// 장부는 부산물이므로 실패해도 UX를 막지 않도록 커맨드 레이어에서 best-effort로 감싼다.
    pub fn insert_quality_records(
        &mut self,
        project_id: &str,
        records: &[QualityRecordRow],
    ) -> Result<usize, IteError> {
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO quality_records (
                    id, project_id, created_at,
                    doc_ref, route_id, direction, content_type,
                    stage, caught_by, executor, producer_model, reviewer_model,
                    finding_type, severity, disposition, promotion_status, matched_rule,
                    segment_json, finding_json, origin_json
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
                )",
            )?;
            for r in records {
                stmt.execute(rusqlite::params![
                    r.id,
                    project_id,
                    r.created_at,
                    r.doc_ref,
                    r.route_id,
                    r.direction,
                    r.content_type,
                    r.stage,
                    r.caught_by,
                    r.executor,
                    r.producer_model,
                    r.reviewer_model,
                    r.finding_type,
                    r.severity,
                    r.disposition,
                    r.promotion_status,
                    r.matched_rule,
                    r.segment_json,
                    r.finding_json,
                    r.origin_json,
                ])?;
            }
        }
        tx.commit()?;
        Ok(records.len())
    }

    /// 필터 조건으로 품질 레코드 조회 (설계서 §4.7 #2).
    pub fn query_quality_records(
        &self,
        project_id: &str,
        filter: &QualityRecordFilter,
    ) -> Result<Vec<QualityRecordRow>, IteError> {
        // 동적 WHERE 절 조립 (파라미터 바인딩으로 인젝션 방지)
        let mut sql = String::from(
            "SELECT id, created_at, doc_ref, route_id, direction, content_type,
                    stage, caught_by, executor, producer_model, reviewer_model,
                    finding_type, severity, disposition, promotion_status, matched_rule,
                    segment_json, finding_json, origin_json
             FROM quality_records WHERE project_id = ?1",
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(project_id.to_string())];

        if let Some(since) = filter.since {
            params.push(Box::new(since));
            sql.push_str(&format!(" AND created_at >= ?{}", params.len()));
        }
        if let Some(stage) = &filter.stage {
            params.push(Box::new(stage.clone()));
            sql.push_str(&format!(" AND stage = ?{}", params.len()));
        }
        if let Some(disposition) = &filter.disposition {
            params.push(Box::new(disposition.clone()));
            sql.push_str(&format!(" AND disposition = ?{}", params.len()));
        }
        if let Some(promotion_status) = &filter.promotion_status {
            params.push(Box::new(promotion_status.clone()));
            sql.push_str(&format!(" AND promotion_status = ?{}", params.len()));
        }
        sql.push_str(" ORDER BY created_at ASC");
        // limit은 clamp: 0 이하는 무제한 취급하지 않고 기본값으로 방어
        let limit = filter.limit.filter(|&n| n > 0).unwrap_or(1000);
        params.push(Box::new(limit));
        sql.push_str(&format!(" LIMIT ?{}", params.len()));

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
        let iter = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(QualityRecordRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                doc_ref: row.get(2)?,
                route_id: row.get(3)?,
                direction: row.get(4)?,
                content_type: row.get(5)?,
                stage: row.get(6)?,
                caught_by: row.get(7)?,
                executor: row.get(8)?,
                producer_model: row.get(9)?,
                reviewer_model: row.get(10)?,
                finding_type: row.get(11)?,
                severity: row.get(12)?,
                disposition: row.get(13)?,
                promotion_status: row.get(14)?,
                matched_rule: row.get(15)?,
                segment_json: row.get(16)?,
                finding_json: row.get(17)?,
                origin_json: row.get(18)?,
            })
        })?;

        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// 특정 레코드들의 disposition을 갱신 (proposed → accepted/rejected/superseded).
    pub fn update_quality_records_disposition(
        &mut self,
        project_id: &str,
        ids: &[String],
        disposition: &str,
    ) -> Result<usize, IteError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.transaction()?;
        let mut updated = 0usize;
        {
            let mut stmt = tx.prepare(
                "UPDATE quality_records SET disposition = ?1
                 WHERE project_id = ?2 AND id = ?3",
            )?;
            for id in ids {
                updated += stmt.execute(rusqlite::params![disposition, project_id, id])?;
            }
        }
        tx.commit()?;
        Ok(updated)
    }

    /// 작업 기록(quality_run) append 저장.
    pub fn insert_quality_run(
        &self,
        project_id: &str,
        run: &QualityRunRow,
    ) -> Result<(), IteError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO quality_runs (
                id, project_id, started_at, stage, executor, model,
                direction, route_id, doc_words, findings_count_json, notes
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                run.id,
                project_id,
                run.started_at,
                run.stage,
                run.executor,
                run.model,
                run.direction,
                run.route_id,
                run.doc_words,
                run.findings_count_json,
                run.notes,
            ],
        )?;
        Ok(())
    }

    /// 프로젝트별 작업 기록 조회.
    pub fn load_quality_runs(&self, project_id: &str) -> Result<Vec<QualityRunRow>, IteError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, started_at, stage, executor, model, direction, route_id,
                    doc_words, findings_count_json, notes
             FROM quality_runs WHERE project_id = ?1 ORDER BY started_at ASC",
        )?;
        let iter = stmt.query_map([project_id], |row| {
            Ok(QualityRunRow {
                id: row.get(0)?,
                started_at: row.get(1)?,
                stage: row.get(2)?,
                executor: row.get(3)?,
                model: row.get(4)?,
                direction: row.get(5)?,
                route_id: row.get(6)?,
                doc_words: row.get(7)?,
                findings_count_json: row.get(8)?,
                notes: row.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
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
        self.conn
            .execute("DELETE FROM mcp_servers WHERE id = ?1", [id])?;
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use tempfile::NamedTempFile;

    use super::Database;
    use crate::error::IteError;
    use crate::models::{
        BlockMetadata, EditorBlock, IteProject, ProjectMetadata, ProjectSettings, SegmentGroup,
    };

    fn build_test_project(project_id: &str) -> IteProject {
        let now = chrono::Utc::now().timestamp_millis();
        let source_id = "source-1".to_string();
        let target_id = "target-1".to_string();

        let mut blocks = HashMap::new();
        blocks.insert(
            source_id.clone(),
            EditorBlock {
                id: source_id.clone(),
                block_type: "source".to_string(),
                content: "<p>Hello</p>".to_string(),
                hash: "hash-source".to_string(),
                metadata: BlockMetadata {
                    author: None,
                    created_at: now,
                    updated_at: now,
                    tags: vec![],
                    comments: None,
                },
            },
        );
        blocks.insert(
            target_id.clone(),
            EditorBlock {
                id: target_id.clone(),
                block_type: "target".to_string(),
                content: "<p>안녕하세요</p>".to_string(),
                hash: "hash-target".to_string(),
                metadata: BlockMetadata {
                    author: None,
                    created_at: now,
                    updated_at: now,
                    tags: vec![],
                    comments: None,
                },
            },
        );

        IteProject {
            id: project_id.to_string(),
            version: "1.0.0".to_string(),
            metadata: ProjectMetadata {
                title: "Test Project".to_string(),
                description: None,
                domain: "general".to_string(),
                target_language: Some("ko".to_string()),
                created_at: now,
                updated_at: now,
                author: None,
                glossary_paths: None,
                settings: ProjectSettings {
                    strictness_level: 0.5,
                    auto_save: true,
                    auto_save_interval: 30_000,
                    theme: "system".to_string(),
                },
            },
            segments: vec![SegmentGroup {
                group_id: "segment-1".to_string(),
                source_ids: vec![source_id],
                target_ids: vec![target_id],
                is_aligned: true,
                order: 0,
            }],
            blocks,
        }
    }

    #[test]
    fn history_snapshot_lifecycle_filters_legacy_null_rows() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-history-test");
        db.save_project(&project).expect("failed to save project");

        let snapshot_json =
            serde_json::to_string(&project.blocks).expect("failed to serialize snapshot");
        let snapshot_id = db
            .create_history_snapshot(
                &project.id,
                "manual snapshot",
                &snapshot_json,
                Some("chat summary"),
            )
            .expect("failed to create snapshot");

        db.update_history_snapshot_description(&snapshot_id, &project.id, "renamed snapshot")
            .expect("failed to rename snapshot");

        let legacy_id = uuid::Uuid::new_v4().to_string();
        db.conn
            .execute(
                "INSERT INTO history (id, project_id, timestamp, description, changes_json, snapshot_json, chat_summary)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                (
                    legacy_id,
                    &project.id,
                    chrono::Utc::now().timestamp_millis(),
                    "legacy null snapshot",
                    "[]",
                    Option::<String>::None,
                ),
            )
            .expect("failed to insert legacy history row");

        let list = db
            .list_history_metadata(&project.id)
            .expect("failed to list history metadata");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, snapshot_id);
        assert_eq!(list[0].description, "renamed snapshot");

        let loaded_snapshot = db
            .get_history_snapshot(&snapshot_id, &project.id)
            .expect("failed to load snapshot");
        assert_eq!(
            loaded_snapshot.snapshot_json.as_deref(),
            Some(snapshot_json.as_str())
        );
        assert_eq!(loaded_snapshot.description, "renamed snapshot");

        db.delete_history_snapshot(&snapshot_id, &project.id)
            .expect("failed to delete snapshot");
        assert!(
            db.delete_history_snapshot(&snapshot_id, &project.id)
                .is_err(),
            "deleting a missing snapshot should return error"
        );
        let after_delete = db
            .list_history_metadata(&project.id)
            .expect("failed to list history after delete");
        assert!(after_delete.is_empty());
    }

    #[test]
    fn prune_old_snapshots_counts_only_real_snapshots() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-history-prune-test");
        db.save_project(&project).expect("failed to save project");

        let base_ts = chrono::Utc::now().timestamp_millis();
        let snapshot_json =
            serde_json::to_string(&project.blocks).expect("failed to serialize snapshot");

        // 레거시 row(NULL snapshot_json)는 prune 카운트에서 제외되어야 한다.
        for i in 0..10 {
            let legacy_id = uuid::Uuid::new_v4().to_string();
            let description = format!("legacy-null-{}", i);
            db.conn
                .execute(
                    "INSERT INTO history (id, project_id, timestamp, description, changes_json, snapshot_json, chat_summary)
                     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                    (
                        legacy_id,
                        &project.id,
                        base_ts + 1_000_000 + i as i64,
                        description,
                        "[]",
                        Option::<String>::None,
                    ),
                )
                .expect("failed to insert legacy history row");
        }

        for i in 0..55 {
            let snapshot_id = uuid::Uuid::new_v4().to_string();
            let description = format!("snapshot-{}", i);
            db.conn
                .execute(
                    "INSERT INTO history (id, project_id, timestamp, description, changes_json, snapshot_json, chat_summary)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    (
                        snapshot_id,
                        &project.id,
                        base_ts + i as i64,
                        description,
                        "[]",
                        &snapshot_json,
                        Option::<String>::None,
                    ),
                )
                .expect("failed to insert real snapshot row");
        }

        db.prune_old_snapshots(&project.id, 50)
            .expect("failed to prune snapshots");

        let list = db
            .list_history_metadata(&project.id)
            .expect("failed to list history metadata");
        assert_eq!(list.len(), 50);
        assert_eq!(list[0].description, "snapshot-54");
        assert_eq!(list[49].description, "snapshot-5");

        let legacy_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM history WHERE project_id = ?1 AND snapshot_json IS NULL",
                [&project.id],
                |row| row.get(0),
            )
            .expect("failed to count legacy rows");
        assert_eq!(legacy_count, 10);
    }

    #[test]
    fn create_history_snapshot_rejects_invalid_snapshot_json() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-history-invalid-json-test");
        db.save_project(&project).expect("failed to save project");

        let err = db
            .create_history_snapshot(&project.id, "invalid snapshot", "not-a-json", None)
            .expect_err("invalid snapshot json should fail");
        assert!(
            matches!(err, IteError::Serialization(_)),
            "expected serialization error, got: {err:?}"
        );

        let list = db
            .list_history_metadata(&project.id)
            .expect("failed to list history metadata");
        assert!(list.is_empty(), "invalid snapshot should not be inserted");
    }

    #[test]
    fn upsert_auto_snapshot_creates_new_when_none_exists() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-auto-1");
        db.save_project(&project).expect("failed to save project");

        let snapshot_json =
            serde_json::to_string(&project.blocks).expect("failed to serialize blocks");

        let (id, created) = db
            .upsert_auto_snapshot(&project.id, "자동 저장 10:00", &snapshot_json, None)
            .expect("upsert failed");

        assert!(created, "첫 번째 호출은 신규 생성이어야 한다");
        assert!(!id.is_empty());

        let metas = db.list_history_metadata(&project.id).expect("list failed");
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].description, "자동 저장 10:00");
    }

    #[test]
    fn upsert_auto_snapshot_overwrites_existing_auto_snapshot() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-auto-2");
        db.save_project(&project).expect("failed to save project");

        let snapshot_json =
            serde_json::to_string(&project.blocks).expect("failed to serialize blocks");

        // 첫 번째 upsert — 신규 생성
        let (id1, created1) = db
            .upsert_auto_snapshot(&project.id, "자동 저장 10:00", &snapshot_json, None)
            .expect("first upsert failed");
        assert!(created1);

        // 두 번째 upsert — 덮어쓰기
        let (id2, created2) = db
            .upsert_auto_snapshot(&project.id, "자동 저장 10:03", &snapshot_json, None)
            .expect("second upsert failed");

        assert!(!created2, "두 번째 호출은 덮어쓰기여야 한다");
        assert_eq!(id1, id2, "덮어쓸 때 ID는 동일해야 한다");

        // 목록에는 1개만 있어야 함
        let metas = db.list_history_metadata(&project.id).expect("list failed");
        let auto_snaps: Vec<_> = metas
            .iter()
            .filter(|m| m.description.starts_with("자동 저장"))
            .collect();
        assert_eq!(
            auto_snaps.len(),
            1,
            "자동 저장 스냅샷은 1개만 존재해야 한다"
        );
        assert_eq!(
            auto_snaps[0].description, "자동 저장 10:03",
            "description이 갱신되어야 한다"
        );
    }

    #[test]
    fn upsert_auto_snapshot_does_not_overwrite_manual_snapshots() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-auto-3");
        db.save_project(&project).expect("failed to save project");

        let snapshot_json =
            serde_json::to_string(&project.blocks).expect("failed to serialize blocks");

        // 수동 스냅샷 생성
        db.create_history_snapshot(&project.id, "manual checkpoint", &snapshot_json, None)
            .expect("manual snapshot failed");

        // auto upsert — 수동 스냅샷과 별개로 신규 생성되어야 함
        let (_, created) = db
            .upsert_auto_snapshot(&project.id, "자동 저장 10:05", &snapshot_json, None)
            .expect("upsert failed");
        assert!(created, "수동 스냅샷이 있어도 auto는 새로 생성되어야 한다");

        let metas = db.list_history_metadata(&project.id).expect("list failed");
        assert_eq!(metas.len(), 2, "수동 + 자동 총 2개여야 한다");
    }

    #[test]
    fn upsert_auto_snapshot_rejects_invalid_json() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-auto-4");
        db.save_project(&project).expect("failed to save project");

        let result =
            db.upsert_auto_snapshot(&project.id, "자동 저장 10:00", "not-valid-json", None);

        assert!(result.is_err(), "잘못된 JSON은 에러를 반환해야 한다");
    }

    #[test]
    fn save_and_load_comments_roundtrip() {
        use crate::db::CommentRow;

        let file = NamedTempFile::new().expect("failed to create temp db file");
        let mut db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-comments-test");
        db.save_project(&project).expect("failed to save project");

        let comments = vec![
            CommentRow {
                id: "cmt_a".to_string(),
                field: "source".to_string(),
                segment_group_id: Some("segment-1".to_string()),
                excerpt: "Hello".to_string(),
                comment: "인사말 톤 확인".to_string(),
                resolved: false,
                created_at: 1000,
            },
            CommentRow {
                id: "cmt_b".to_string(),
                field: "target".to_string(),
                segment_group_id: None,
                excerpt: "안녕하세요".to_string(),
                comment: "존댓말 유지".to_string(),
                resolved: true,
                created_at: 2000,
            },
        ];

        db.save_comments(&project.id, &comments)
            .expect("failed to save comments");

        let loaded = db.load_comments(&project.id).expect("failed to load comments");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "cmt_a");
        assert_eq!(loaded[0].segment_group_id.as_deref(), Some("segment-1"));
        assert!(!loaded[0].resolved);
        assert_eq!(loaded[1].id, "cmt_b");
        assert!(loaded[1].resolved);

        // 전체 교체 저장: 빈 배열로 저장하면 모두 삭제
        db.save_comments(&project.id, &[])
            .expect("failed to clear comments");
        let after_clear = db
            .load_comments(&project.id)
            .expect("failed to load after clear");
        assert!(after_clear.is_empty());
    }

    fn build_quality_record(id: &str, stage: &str, disposition: &str) -> super::QualityRecordRow {
        super::QualityRecordRow {
            id: id.to_string(),
            created_at: 1_780_000_000_000,
            doc_ref: None,
            route_id: None,
            direction: Some("ko_to_en".to_string()),
            content_type: Some("design_doc".to_string()),
            stage: Some(stage.to_string()),
            caught_by: Some("review_agent".to_string()),
            executor: Some("app".to_string()),
            producer_model: None,
            reviewer_model: Some("claude-opus-4-8".to_string()),
            finding_type: Some("accuracy.omission".to_string()),
            severity: Some("major".to_string()),
            disposition: Some(disposition.to_string()),
            promotion_status: Some("candidate".to_string()),
            matched_rule: None,
            segment_json: Some(r#"{"source":"원문","output":"bad","corrected":null,"context":null}"#.to_string()),
            finding_json: Some(r#"{"type":"accuracy.omission","severity":"major","description":"누락","suggested_fix":null}"#.to_string()),
            origin_json: Some(r#"{"stage":"s1_translate","caught_by":"review_agent","executor":"app"}"#.to_string()),
        }
    }

    #[test]
    fn quality_ledger_insert_query_update_and_cascade() {
        let file = NamedTempFile::new().expect("failed to create temp db file");
        let mut db = Database::new(file.path()).expect("failed to create database");
        db.initialize().expect("failed to initialize database");

        let project = build_test_project("project-quality-test");
        db.save_project(&project).expect("failed to save project");

        // append 삽입
        let records = vec![
            build_quality_record("qr_1", "s1_translate", "proposed"),
            build_quality_record("qr_2", "s2_polish", "proposed"),
        ];
        let count = db
            .insert_quality_records(&project.id, &records)
            .expect("failed to insert records");
        assert_eq!(count, 2);

        // 전체 조회
        let all = db
            .query_quality_records(&project.id, &super::QualityRecordFilter::default())
            .expect("failed to query");
        assert_eq!(all.len(), 2);

        // stage 필터
        let polish_only = db
            .query_quality_records(
                &project.id,
                &super::QualityRecordFilter {
                    stage: Some("s2_polish".to_string()),
                    ..Default::default()
                },
            )
            .expect("failed to query filtered");
        assert_eq!(polish_only.len(), 1);
        assert_eq!(polish_only[0].id, "qr_2");

        // disposition 갱신
        let updated = db
            .update_quality_records_disposition(&project.id, &["qr_1".to_string()], "accepted")
            .expect("failed to update disposition");
        assert_eq!(updated, 1);
        let accepted = db
            .query_quality_records(
                &project.id,
                &super::QualityRecordFilter {
                    disposition: Some("accepted".to_string()),
                    ..Default::default()
                },
            )
            .expect("failed to query accepted");
        assert_eq!(accepted.len(), 1);
        assert_eq!(accepted[0].id, "qr_1");

        // INSERT OR REPLACE 멱등성: 같은 id 재삽입은 중복을 만들지 않는다
        db.insert_quality_records(&project.id, &[build_quality_record("qr_1", "s1_translate", "proposed")])
            .expect("re-insert");
        let after_reinsert = db
            .query_quality_records(&project.id, &super::QualityRecordFilter::default())
            .expect("query after reinsert");
        assert_eq!(after_reinsert.len(), 2);

        // quality_run 삽입/조회
        let run = super::QualityRunRow {
            id: "run_1".to_string(),
            started_at: 1_780_000_000_000,
            stage: "s2_polish".to_string(),
            executor: Some("app".to_string()),
            model: Some("gpt-5.5".to_string()),
            direction: Some("ko_to_en".to_string()),
            route_id: None,
            doc_words: Some(1420),
            findings_count_json: Some(r#"{"critical":0,"major":3,"minor":5}"#.to_string()),
            notes: None,
        };
        db.insert_quality_run(&project.id, &run)
            .expect("failed to insert run");
        let runs = db.load_quality_runs(&project.id).expect("failed to load runs");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].doc_words, Some(1420));

        // 프로젝트 삭제 시 장부도 CASCADE 정리
        db.delete_project(&project.id)
            .expect("failed to delete project");
        let after_delete = db
            .query_quality_records(&project.id, &super::QualityRecordFilter::default())
            .expect("query after delete");
        assert!(after_delete.is_empty());
        let runs_after_delete = db
            .load_quality_runs(&project.id)
            .expect("load runs after delete");
        assert!(runs_after_delete.is_empty());
    }
}
