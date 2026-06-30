//! Comment Commands
//!
//! 인라인 코멘트(텍스트 마킹 + 코멘트) 영속화 API.
//! 마크 span 자체는 blocks.content HTML에 영속되고, 코멘트 본문/메타만 여기서 다룬다.

use serde::Deserialize;
use tauri::State;

use super::AcquireDb;
use crate::db::{CommentRow, DbState};
use crate::error::{CommandError, CommandResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCommentsArgs {
    pub project_id: String,
    pub comments: Vec<CommentRow>,
}

/// 프로젝트 코멘트 전체 교체 저장
#[tauri::command]
pub fn save_comments(args: SaveCommentsArgs, db_state: State<DbState>) -> CommandResult<()> {
    let mut db = db_state.acquire()?;
    db.save_comments(&args.project_id, &args.comments)
        .map_err(CommandError::from)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadCommentsArgs {
    pub project_id: String,
}

/// 프로젝트별 코멘트 목록 로드
#[tauri::command]
pub fn load_comments(
    args: LoadCommentsArgs,
    db_state: State<DbState>,
) -> CommandResult<Vec<CommentRow>> {
    let db = db_state.acquire()?;
    let rows = db
        .load_comments(&args.project_id)
        .map_err(CommandError::from)?;
    Ok(rows)
}
