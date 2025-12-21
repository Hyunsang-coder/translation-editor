//! Block Commands
//!
//! 블록 관리 관련 Tauri 명령어

use tauri::State;

use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::EditorBlock;

/// 블록 조회
#[tauri::command]
pub fn get_block(
    block_id: String,
    project_id: String,
    db_state: State<DbState>,
) -> CommandResult<EditorBlock> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.get_block(&block_id, &project_id)
        .map_err(CommandError::from)
}

/// 블록 업데이트
#[tauri::command]
pub fn update_block(
    block: EditorBlock,
    project_id: String,
    db_state: State<DbState>,
) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.update_block(&block, &project_id)
        .map_err(CommandError::from)
}

/// 블록 분할
#[tauri::command]
pub fn split_block(
    block_id: String,
    split_position: usize,
    project_id: String,
    db_state: State<DbState>,
) -> CommandResult<(EditorBlock, EditorBlock)> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    // 기존 블록 로드
    let original_block = db
        .get_block(&block_id, &project_id)
        .map_err(CommandError::from)?;

    let now = chrono::Utc::now().timestamp_millis();
    let new_block_id = uuid::Uuid::new_v4().to_string();

    // 콘텐츠 분할
    let original_content = &original_block.content;
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

    // TODO: 데이터베이스에 저장 및 세그먼트 업데이트

    Ok((updated_original, new_block))
}

/// 블록 병합
#[tauri::command]
pub fn merge_blocks(
    block_ids: Vec<String>,
    project_id: String,
    db_state: State<DbState>,
) -> CommandResult<EditorBlock> {
    if block_ids.len() < 2 {
        return Err(CommandError {
            code: "INVALID_OPERATION".to_string(),
            message: "At least 2 blocks are required for merging".to_string(),
            details: None,
        });
    }

    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

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

    // TODO: 데이터베이스에 저장 및 세그먼트 업데이트

    Ok(merged_block)
}

