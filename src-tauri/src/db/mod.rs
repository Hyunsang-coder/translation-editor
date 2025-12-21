//! Database Module
//!
//! SQLite 데이터베이스 관리

mod schema;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use rusqlite::backup::Backup;

use crate::error::IteError;
use crate::models::{EditorBlock, IteProject, SegmentGroup};

#[derive(Debug, Clone)]
pub struct RecentProjectRow {
    pub id: String,
    pub title: String,
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
        Ok(Self { conn })
    }

    /// 데이터베이스 스키마 초기화
    pub fn initialize(&self) -> Result<(), IteError> {
        self.conn.execute_batch(schema::CREATE_SCHEMA)?;
        Ok(())
    }

    /// 현재 DB를 파일로 내보내기(.ite: SQLite DB 파일)
    pub fn export_db_to_file(&self, out_path: &Path) -> Result<(), IteError> {
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut out_conn = Connection::open(out_path)?;
        // 스키마가 없어도 백업이 전체 DB를 복제하지만,
        // 일부 환경에서의 안정성을 위해 명시적으로 초기화합니다.
        out_conn.execute_batch(schema::CREATE_SCHEMA)?;

        let backup = Backup::new(&self.conn, &mut out_conn)?;
        backup.run_to_completion(5, std::time::Duration::from_millis(10), None)?;
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
        let mut stmt = self.conn.prepare("SELECT id FROM projects ORDER BY updated_at DESC")?;
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
        tx.execute(
            "INSERT OR REPLACE INTO projects (id, version, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
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

