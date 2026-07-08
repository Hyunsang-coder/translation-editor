//! Block Commands
//!
//! 블록 관리 관련 Tauri 명령어
//! 분할/병합은 다중 쓰기이므로 DB 레이어의 단일 트랜잭션 메서드
//! (`apply_block_split`/`apply_block_merge`)로 원자적으로 커밋한다.

use tauri::State;

use super::run_db_task;
use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::EditorBlock;

/// 블록 조회
#[tauri::command]
pub async fn get_block(
    block_id: String,
    project_id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<EditorBlock> {
    run_db_task(&db_state, move |db| {
        db.get_block(&block_id, &project_id)
            .map_err(CommandError::from)
    })
    .await
}

/// 블록 업데이트
#[tauri::command]
pub async fn update_block(
    block: EditorBlock,
    project_id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.update_block(&block, &project_id)
            .map_err(CommandError::from)
    })
    .await
}

/// 블록 분할
#[tauri::command]
pub async fn split_block(
    block_id: String,
    split_position: usize,
    project_id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<(EditorBlock, EditorBlock)> {
    run_db_task(&db_state, move |db| {
        // 기존 블록 로드
        let original_block = db
            .get_block(&block_id, &project_id)
            .map_err(CommandError::from)?;

        let now = chrono::Utc::now().timestamp_millis();
        let new_block_id = uuid::Uuid::new_v4().to_string();

        // 콘텐츠 분할
        let original_content = &original_block.content;
        if split_position < original_content.len()
            && !original_content.is_char_boundary(split_position)
        {
            return Err(CommandError {
                code: "INVALID_POSITION".to_string(),
                message: format!(
                    "split_position {} is not a valid character boundary",
                    split_position
                ),
                details: None,
            });
        }
        let first_part = if split_position < original_content.len() {
            original_content[..split_position].to_string()
        } else {
            original_content.clone()
        };
        let second_part = if split_position < original_content.len() {
            original_content[split_position..].to_string()
        } else {
            String::new()
        };

        // 업데이트된 원본 블록
        let updated_original = EditorBlock {
            content: first_part.clone(),
            hash: format!("{:x}", md5::compute(&first_part)),
            metadata: crate::models::BlockMetadata {
                updated_at: now,
                ..original_block.metadata.clone()
            },
            ..original_block.clone()
        };

        // 새 블록
        let new_block = EditorBlock {
            id: new_block_id,
            block_type: original_block.block_type.clone(),
            content: second_part.clone(),
            hash: format!("{:x}", md5::compute(&second_part)),
            metadata: crate::models::BlockMetadata {
                author: original_block.metadata.author.clone(),
                created_at: now,
                updated_at: now,
                tags: Vec::new(),
                comments: None,
            },
        };

        // update+insert를 단일 트랜잭션으로 저장 (중간 실패 시 콘텐츠 중복 방지)
        db.apply_block_split(&updated_original, &new_block, &project_id)
            .map_err(CommandError::from)?;

        Ok((updated_original, new_block))
    })
    .await
}

/// 블록 병합
#[tauri::command]
pub async fn merge_blocks(
    block_ids: Vec<String>,
    project_id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<EditorBlock> {
    if block_ids.len() < 2 {
        return Err(CommandError {
            code: "INVALID_OPERATION".to_string(),
            message: "At least 2 blocks are required for merging".to_string(),
            details: None,
        });
    }

    run_db_task(&db_state, move |db| {
        // 모든 블록 로드
        let mut blocks = Vec::new();
        for block_id in &block_ids {
            let block = db
                .get_block(block_id, &project_id)
                .map_err(CommandError::from)?;
            blocks.push(block);
        }

        // 콘텐츠 병합
        let merged_content: String = blocks.iter().map(|b| b.content.clone()).collect();
        let now = chrono::Utc::now().timestamp_millis();

        // 첫 번째 블록을 기준으로 병합된 블록 생성
        let first_block = blocks.first().ok_or_else(|| CommandError {
            code: "INVALID_OPERATION".to_string(),
            message: "No blocks to merge".to_string(),
            details: None,
        })?;

        let merged_block = EditorBlock {
            id: first_block.id.clone(),
            block_type: first_block.block_type.clone(),
            content: merged_content.clone(),
            hash: format!("{:x}", md5::compute(&merged_content)),
            metadata: crate::models::BlockMetadata {
                updated_at: now,
                ..first_block.metadata.clone()
            },
        };

        // 업데이트 + 나머지 블록 삭제를 단일 트랜잭션으로 저장 (부분 실패 시 콘텐츠 중복 방지)
        let removed_ids: Vec<String> = block_ids.iter().skip(1).cloned().collect();
        db.apply_block_merge(&merged_block, &removed_ids, &project_id)
            .map_err(CommandError::from)?;

        Ok(merged_block)
    })
    .await
}
