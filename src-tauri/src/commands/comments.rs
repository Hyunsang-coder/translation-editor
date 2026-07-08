//! Comment Commands
//!
//! 인라인 코멘트(텍스트 마킹 + 코멘트) 영속화 API.
//! 마크 span 자체는 blocks.content HTML에 영속되고, 코멘트 본문/메타만 여기서 다룬다.
//! async + `run_db_task`(spawn_blocking)로 실행되어 메인 스레드를 점유하지 않는다.

use serde::Deserialize;
use tauri::State;

use super::run_db_task;
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
pub async fn save_comments(
    args: SaveCommentsArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.save_comments(&args.project_id, &args.comments)
            .map_err(CommandError::from)
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadCommentsArgs {
    pub project_id: String,
}

/// 프로젝트별 코멘트 목록 로드
#[tauri::command]
pub async fn load_comments(
    args: LoadCommentsArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<CommentRow>> {
    run_db_task(&db_state, move |db| {
        db.load_comments(&args.project_id).map_err(CommandError::from)
    })
    .await
}
