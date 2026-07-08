//! History Commands
//!
//! 버전 히스토리 관련 Tauri 명령어
//! 스냅샷은 blocks 전체 JSON을 다루므로 async + `run_db_task`로 실행한다.

use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

use super::run_db_task;
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
pub async fn create_snapshot(
    args: CreateSnapshotArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<String> {
    run_db_task(&db_state, move |db| {
        db.create_history_snapshot(
            &args.project_id,
            &args.description,
            &args.blocks_json,
            args.chat_summary.as_deref(),
        )
        .map_err(CommandError::from)
    })
    .await
}

/// 스냅샷 복원
#[tauri::command]
pub async fn restore_snapshot(
    args: ProjectSnapshotArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<HashMap<String, EditorBlock>> {
    run_db_task(&db_state, move |db| {
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

        serde_json::from_str::<HashMap<String, EditorBlock>>(&snapshot_json).map_err(|e| {
            CommandError {
                code: "SERIALIZATION_ERROR".to_string(),
                message: format!("Failed to parse snapshotJson: {}", e),
                details: None,
            }
        })
    })
    .await
}

/// 히스토리 목록 조회
#[tauri::command]
pub async fn list_history(
    args: ProjectArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<HistorySnapshotMeta>> {
    run_db_task(&db_state, move |db| {
        db.list_history_metadata(&args.project_id)
            .map_err(CommandError::from)
    })
    .await
}

/// 스냅샷 단건 조회
#[tauri::command]
pub async fn get_snapshot(
    args: ProjectSnapshotArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<HistorySnapshot> {
    run_db_task(&db_state, move |db| {
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
    })
    .await
}

/// 스냅샷 삭제
#[tauri::command]
pub async fn delete_snapshot(
    args: ProjectSnapshotArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.delete_history_snapshot(&args.snapshot_id, &args.project_id)
            .map_err(CommandError::from)
    })
    .await
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
pub async fn upsert_auto_snapshot(
    args: CreateSnapshotArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<UpsertAutoSnapshotResult> {
    run_db_task(&db_state, move |db| {
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
    })
    .await
}

/// 스냅샷 이름(설명) 변경
#[tauri::command]
pub async fn rename_snapshot(
    args: RenameSnapshotArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.update_history_snapshot_description(
            &args.snapshot_id,
            &args.project_id,
            &args.description,
        )
        .map_err(CommandError::from)
    })
    .await
}
