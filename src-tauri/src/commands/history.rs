//! History Commands
//!
//! 버전 히스토리 관련 Tauri 명령어
//! NOTE: 아직 미구현 상태이며, 호출 시 NOT_IMPLEMENTED 에러를 반환합니다.

use tauri::State;

use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::HistorySnapshot;

fn not_implemented(feature: &str) -> CommandError {
    CommandError {
        code: "NOT_IMPLEMENTED".to_string(),
        message: format!("History feature '{}' is not yet implemented", feature),
        details: None,
    }
}

/// 스냅샷 생성
#[tauri::command]
pub fn create_snapshot(
    _project_id: String,
    _description: String,
    _chat_summary: Option<String>,
    _db_state: State<DbState>,
) -> CommandResult<HistorySnapshot> {
    Err(not_implemented("create_snapshot"))
}

/// 스냅샷 복원
#[tauri::command]
pub fn restore_snapshot(
    _project_id: String,
    _snapshot_id: String,
    _db_state: State<DbState>,
) -> CommandResult<()> {
    Err(not_implemented("restore_snapshot"))
}

/// 히스토리 목록 조회
#[tauri::command]
pub fn list_history(
    _project_id: String,
    _db_state: State<DbState>,
) -> CommandResult<Vec<HistorySnapshot>> {
    Err(not_implemented("list_history"))
}
