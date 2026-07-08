//! Storage Commands (.ite Import/Export)
//!
//! .ite 파일은 SQLite DB 자체를 패키징한 파일로 취급합니다.
//!
//! 모든 커맨드는 async + `run_db_task`(spawn_blocking)로 실행된다.
//! 특히 export/import는 SQLite Backup을 돌리므로 대형 DB에서 수 초가 걸릴 수 있어,
//! 메인 스레드에서 실행되면 UI 전체가 얼어붙는다 (2026-07-07 리뷰 C1).

use serde::Deserialize;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::run_db_task;
use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::utils::validate_path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDbArgs {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDbArgs {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProjectFileResult {
    pub project_ids: Vec<String>,
    pub backup_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectInfo {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectArgs {
    #[serde(rename = "projectId")]
    pub project_id: String,
}

/// 현재 DB를 .ite 파일로 내보내기
#[tauri::command]
pub async fn export_project_file(
    args: ExportDbArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    // utils::validate_path (Blocklist 적용)
    let out_path = validate_path(&args.path)?;

    run_db_task(&db_state, move |db| {
        db.export_db_to_file(&out_path).map_err(CommandError::from)
    })
    .await
}

/// 프로젝트 삭제(연관 데이터 포함)
#[tauri::command]
pub async fn delete_project(
    args: DeleteProjectArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.delete_project(&args.project_id)
            .map_err(CommandError::from)
    })
    .await
}

/// 전체 프로젝트 삭제(연관 데이터 포함)
#[tauri::command]
pub async fn delete_all_projects(db_state: State<'_, DbState>) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.delete_all_projects().map_err(CommandError::from)
    })
    .await
}

/// .ite 파일을 현재 DB로 가져오기(현재 DB 내용을 덮어씀)
/// 가져온 뒤, DB 안에 있는 projectId 리스트를 반환합니다.
#[tauri::command]
pub async fn import_project_file(
    args: ImportDbArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<String>> {
    // utils::validate_path (Blocklist 적용)
    let in_path = validate_path(&args.path)?;

    run_db_task(&db_state, move |db| {
        db.import_db_from_file(&in_path)
            .map_err(CommandError::from)?;
        db.initialize().map_err(CommandError::from)?;
        db.list_project_ids().map_err(CommandError::from)
    })
    .await
}

/// .ite 파일 import (안전 버전)
/// - import 전 현재 DB를 app_data_dir/ite_backups 아래에 자동 백업
/// - 이후 import 수행
#[tauri::command]
pub async fn import_project_file_safe(
    app: AppHandle,
    args: ImportDbArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ImportProjectFileResult> {
    // utils::validate_path (Blocklist 적용)
    let in_path = validate_path(&args.path)?;

    let backup_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError {
            code: "PATH_ERROR".to_string(),
            message: format!("Failed to get app data dir: {}", e),
            details: None,
        })?
        .join("ite_backups");

    let ts = chrono::Utc::now().timestamp_millis();
    let backup_path = backup_dir.join(format!("backup-before-import-{}.ite", ts));

    run_db_task(&db_state, move |db| {
        // backup current DB
        db.export_db_to_file(&backup_path)
            .map_err(CommandError::from)?;

        // import selected .ite into current DB
        db.import_db_from_file(&in_path)
            .map_err(CommandError::from)?;
        db.initialize().map_err(CommandError::from)?;

        let project_ids = db.list_project_ids().map_err(CommandError::from)?;
        Ok(ImportProjectFileResult {
            project_ids,
            backup_path: backup_path.to_string_lossy().to_string(),
        })
    })
    .await
}

/// DB에 저장된 프로젝트 ID 목록 조회
#[tauri::command]
pub async fn list_project_ids(db_state: State<'_, DbState>) -> CommandResult<Vec<String>> {
    run_db_task(&db_state, |db| {
        db.list_project_ids().map_err(CommandError::from)
    })
    .await
}

/// 최근 프로젝트 목록(간단 메타 포함)
#[tauri::command]
pub async fn list_recent_projects(
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<RecentProjectInfo>> {
    run_db_task(&db_state, |db| {
        let rows = db.list_recent_projects(20).map_err(CommandError::from)?;
        Ok(rows
            .into_iter()
            .map(|r| RecentProjectInfo {
                id: r.id,
                title: r.title,
                updated_at: r.updated_at,
            })
            .collect())
    })
    .await
}
