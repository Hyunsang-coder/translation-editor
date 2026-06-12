//! History Commands
//!
//! 버전 히스토리 관련 Tauri 명령어

use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

use super::AcquireDb;
use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::{EditorBlock, HistorySnapshot, HistorySnapshotMeta};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSnapshotArgs {
    pub project_id: String,
    pub description: String,
    pub blocks_json: String,
    pub chat_summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotArgs {
    pub project_id: String,
    pub snapshot_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArgs {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSnapshotArgs {
    pub project_id: String,
    pub snapshot_id: String,
    pub description: String,
}

/// 스냅샷 생성
#[tauri::command]
pub fn create_snapshot(
    args: CreateSnapshotArgs,
    db_state: State<DbState>,
) -> CommandResult<String> {
    let db = db_state.acquire()?;
    db.create_history_snapshot(
        &args.project_id,
        &args.description,
        &args.blocks_json,
        args.chat_summary.as_deref(),
    )
    .map_err(CommandError::from)
}

/// 스냅샷 복원
#[tauri::command]
pub fn restore_snapshot(
    args: ProjectSnapshotArgs,
    db_state: State<DbState>,
) -> CommandResult<HashMap<String, EditorBlock>> {
    let db = db_state.acquire()?;
    let snapshot = db
        .get_history_snapshot(&args.snapshot_id, &args.project_id)
        .map_err(CommandError::from)?;

    let snapshot_json = snapshot.snapshot_json.ok_or_else(|| CommandError {
        code: "INVALID_OPERATION".to_string(),
        message: format!(
            "Snapshot '{}' does not contain snapshotJson",
            args.snapshot_id
        ),
        details: None,
    })?;

    serde_json::from_str::<HashMap<String, EditorBlock>>(&snapshot_json).map_err(|e| CommandError {
        code: "SERIALIZATION_ERROR".to_string(),
        message: format!("Failed to parse snapshotJson: {}", e),
        details: None,
    })
}

/// 히스토리 목록 조회
#[tauri::command]
pub fn list_history(
    args: ProjectArgs,
    db_state: State<DbState>,
) -> CommandResult<Vec<HistorySnapshotMeta>> {
    let db = db_state.acquire()?;
    db.list_history_metadata(&args.project_id)
        .map_err(CommandError::from)
}

/// 스냅샷 단건 조회
#[tauri::command]
pub fn get_snapshot(
    args: ProjectSnapshotArgs,
    db_state: State<DbState>,
) -> CommandResult<HistorySnapshot> {
    let db = db_state.acquire()?;
    let snapshot = db
        .get_history_snapshot(&args.snapshot_id, &args.project_id)
        .map_err(CommandError::from)?;
    if snapshot.snapshot_json.is_none() {
        return Err(CommandError {
            code: "INVALID_OPERATION".to_string(),
            message: format!(
                "Snapshot '{}' does not contain snapshotJson",
                args.snapshot_id
            ),
            details: None,
        });
    }
    Ok(snapshot)
}

/// 스냅샷 삭제
#[tauri::command]
pub fn delete_snapshot(args: ProjectSnapshotArgs, db_state: State<DbState>) -> CommandResult<()> {
    let db = db_state.acquire()?;
    db.delete_history_snapshot(&args.snapshot_id, &args.project_id)
        .map_err(CommandError::from)
}

/// autoSnapshot 덮어쓰기 또는 신규 생성
/// 반환: { snapshotId, created }
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAutoSnapshotResult {
    pub snapshot_id: String,
    pub created: bool,
}

#[tauri::command]
pub fn upsert_auto_snapshot(
    args: CreateSnapshotArgs,
    db_state: State<DbState>,
) -> CommandResult<UpsertAutoSnapshotResult> {
    let db = db_state.acquire()?;
    let (snapshot_id, created) = db
        .upsert_auto_snapshot(
            &args.project_id,
            &args.description,
            &args.blocks_json,
            args.chat_summary.as_deref(),
        )
        .map_err(CommandError::from)?;
    Ok(UpsertAutoSnapshotResult {
        snapshot_id,
        created,
    })
}

/// 스냅샷 이름(설명) 변경
#[tauri::command]
pub fn rename_snapshot(args: RenameSnapshotArgs, db_state: State<DbState>) -> CommandResult<()> {
    let db = db_state.acquire()?;
    db.update_history_snapshot_description(&args.snapshot_id, &args.project_id, &args.description)
        .map_err(CommandError::from)
}
