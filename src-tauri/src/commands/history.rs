//! History Commands
//!
//! 버전 히스토리 관련 Tauri 명령어

use tauri::State;

use crate::db::DbState;
use crate::error::CommandResult;
use crate::models::HistorySnapshot;

/// 스냅샷 생성
#[tauri::command]
pub fn create_snapshot(
    project_id: String,
    description: String,
    chat_summary: Option<String>,
    _db_state: State<DbState>,
) -> CommandResult<HistorySnapshot> {
    let now = chrono::Utc::now().timestamp_millis();
    let snapshot_id = uuid::Uuid::new_v4().to_string();

    let snapshot = HistorySnapshot {
        id: snapshot_id,
        timestamp: now,
        description,
        block_changes: Vec::new(), // TODO: 실제 변경사항 추적
        chat_summary,
    };

    // TODO: 데이터베이스에 스냅샷 저장
    let _ = project_id; // 사용 예정

    Ok(snapshot)
}

/// 스냅샷 복원
#[tauri::command]
pub fn restore_snapshot(
    project_id: String,
    snapshot_id: String,
    _db_state: State<DbState>,
) -> CommandResult<()> {
    // TODO: 스냅샷 복원 구현
    let _ = (project_id, snapshot_id); // 사용 예정

    Ok(())
}

/// 히스토리 목록 조회
#[tauri::command]
pub fn list_history(
    project_id: String,
    _db_state: State<DbState>,
) -> CommandResult<Vec<HistorySnapshot>> {
    // TODO: 데이터베이스에서 히스토리 로드
    let _ = project_id; // 사용 예정

    Ok(Vec::new())
}

