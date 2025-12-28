//! Storage Commands (.ite Import/Export)
//!
//! .ite 파일은 SQLite DB 자체를 패키징한 파일로 취급합니다.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde::Serialize;
use tauri::{State, AppHandle, Manager};

use crate::db::DbState;
use crate::error::{CommandError, CommandResult};

fn validate_path(path_str: &str) -> CommandResult<PathBuf> {
    let path = Path::new(path_str);
    // 1. 존재 여부 확인 (import 시 필요, export 시에는 부모 디렉토리 확인이 필요할 수 있으나 여기서는 단순화)
    // 단, export는 "파일 생성"이므로 파일이 없어도 되지만, 부모 디렉토리는 있어야 함.
    // 여기서는 공통적으로 "입력된 경로 문자열"을 정규화하는 데 집중합니다.

    // canonicalize는 파일이 존재해야 성공하므로, 
    // export의 경우(파일 생성)에는 부모 디렉토리까지만 체크하거나, 
    // 단순히 경로 상의 ../ 등을 해소하는 로직이 필요합니다.
    
    // 안전을 위해, 파일이 존재하면 canonicalize를 시도하고,
    // 존재하지 않으면(새로 생성) 부모 디렉토리를 canonicalize하여 경로를 조합합니다.
    
    if path.exists() {
        path.canonicalize().map_err(|e| CommandError {
            code: "PATH_ERROR".to_string(),
            message: format!("Invalid path: {}", e),
            details: None,
        })
    } else {
        // 파일이 없는 경우 (Export 등), 부모 디렉토리를 검증
        if let Some(parent) = path.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize().map_err(|e| CommandError {
                    code: "PATH_ERROR".to_string(),
                    message: format!("Invalid parent path: {}", e),
                    details: None,
                })?;
                // 파일명만 붙여서 반환
                Ok(canonical_parent.join(path.file_name().unwrap_or_default()))
            } else {
                // 부모도 없으면 에러
                 Err(CommandError {
                    code: "PATH_ERROR".to_string(),
                    message: "Parent directory does not exist".to_string(),
                    details: None,
                })
            }
        } else {
            // 루트 경로 등이면 그냥 사용 (단, 상대경로 공격 위험은 남지만 OS 레벨에서 처리됨)
             Ok(PathBuf::from(path_str))
        }
    }
}

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
pub fn export_project_file(args: ExportDbArgs, db_state: State<DbState>) -> CommandResult<()> {
    // Path validation (canonicalize)
    let out_path = validate_path(&args.path)?;

    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.export_db_to_file(&out_path).map_err(CommandError::from)?;
    Ok(())
}

/// 프로젝트 삭제(연관 데이터 포함)
#[tauri::command]
pub fn delete_project(args: DeleteProjectArgs, db_state: State<DbState>) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.delete_project(&args.project_id).map_err(CommandError::from)?;
    Ok(())
}

/// 전체 프로젝트 삭제(연관 데이터 포함)
#[tauri::command]
pub fn delete_all_projects(db_state: State<DbState>) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.delete_all_projects().map_err(CommandError::from)?;
    Ok(())
}

/// .ite 파일을 현재 DB로 가져오기(현재 DB 내용을 덮어씀)
/// 가져온 뒤, DB 안에 있는 projectId 리스트를 반환합니다.
#[tauri::command]
pub fn import_project_file(args: ImportDbArgs, db_state: State<DbState>) -> CommandResult<Vec<String>> {
    // Path validation
    let in_path = validate_path(&args.path)?;

    let mut db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.import_db_from_file(&in_path).map_err(CommandError::from)?;
    db.initialize().map_err(CommandError::from)?;
    db.list_project_ids().map_err(CommandError::from)
}

/// .ite 파일 import (안전 버전)
/// - import 전 현재 DB를 app_data_dir/ite_backups 아래에 자동 백업
/// - 이후 import 수행
#[tauri::command]
pub fn import_project_file_safe(
    app: AppHandle,
    args: ImportDbArgs,
    db_state: State<DbState>,
) -> CommandResult<ImportProjectFileResult> {
    // Path validation
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

    let mut db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    // backup current DB
    db.export_db_to_file(&backup_path).map_err(CommandError::from)?;

    // import selected .ite into current DB
    db.import_db_from_file(&in_path).map_err(CommandError::from)?;
    db.initialize().map_err(CommandError::from)?;

    let project_ids = db.list_project_ids().map_err(CommandError::from)?;
    Ok(ImportProjectFileResult {
        project_ids,
        backup_path: backup_path.to_string_lossy().to_string(),
    })
}

/// DB에 저장된 프로젝트 ID 목록 조회
#[tauri::command]
pub fn list_project_ids(db_state: State<DbState>) -> CommandResult<Vec<String>> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.list_project_ids().map_err(CommandError::from)
}

/// 최근 프로젝트 목록(간단 메타 포함)
#[tauri::command]
pub fn list_recent_projects(db_state: State<DbState>) -> CommandResult<Vec<RecentProjectInfo>> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    let rows = db.list_recent_projects(20).map_err(CommandError::from)?;
    Ok(rows
        .into_iter()
        .map(|r| RecentProjectInfo {
            id: r.id,
            title: r.title,
            updated_at: r.updated_at,
        })
        .collect())
}
