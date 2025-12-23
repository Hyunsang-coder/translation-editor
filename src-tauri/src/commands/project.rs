//! Project Commands
//!
//! 프로젝트 관리 관련 Tauri 명령어

use tauri::State;
use serde::Deserialize;

use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::IteProject;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectArgs {
    pub title: String,
    pub domain: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProjectArgs {
    #[serde(rename = "projectId")]
    pub project_id: String,
}

/// 새 프로젝트 생성
#[tauri::command]
pub fn create_project(
    args: CreateProjectArgs,
    db_state: State<DbState>,
) -> CommandResult<IteProject> {
    let now = chrono::Utc::now().timestamp_millis();
    let project_id = uuid::Uuid::new_v4().to_string();

    // 초기 빈 블록 생성을 위한 ID
    let source_block_id = uuid::Uuid::new_v4().to_string();
    let target_block_id = uuid::Uuid::new_v4().to_string();
    let segment_group_id = uuid::Uuid::new_v4().to_string();

    // 블록 맵 생성 및 초기 빈 블록 추가
    let mut blocks = std::collections::HashMap::new();
    
    // Source Block (Empty)
    blocks.insert(source_block_id.clone(), crate::models::EditorBlock {
        id: source_block_id.clone(),
        block_type: "source".to_string(),
        content: "<p></p>".to_string(),
        hash: String::new(),
        metadata: crate::models::BlockMetadata {
            author: None,
            created_at: now,
            updated_at: now,
            tags: Vec::new(),
            comments: None,
        },
    });

    // Target Block (Empty)
    blocks.insert(target_block_id.clone(), crate::models::EditorBlock {
        id: target_block_id.clone(),
        block_type: "target".to_string(),
        content: "<p></p>".to_string(),
        hash: String::new(),
        metadata: crate::models::BlockMetadata {
            author: None,
            created_at: now,
            updated_at: now,
            tags: Vec::new(),
            comments: None,
        },
    });

    // 세그먼트 생성 (1:1 매핑)
    let segments = vec![crate::models::SegmentGroup {
        group_id: segment_group_id,
        source_ids: vec![source_block_id],
        target_ids: vec![target_block_id],
        is_aligned: true,
        order: 0,
    }];

    let project = IteProject {
        id: project_id.clone(),
        version: "1.0.0".to_string(),
        metadata: crate::models::ProjectMetadata {
            title: args.title,
            description: None,
            domain: args.domain,
            target_language: None,
            created_at: now,
            updated_at: now,
            author: None,
            glossary_paths: None,
            settings: crate::models::ProjectSettings {
                strictness_level: 0.5,
                auto_save: true,
                auto_save_interval: 30000,
                theme: "system".to_string(),
            },
        },
        segments,
        blocks,
        history: Vec::new(),
    };

    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.save_project(&project).map_err(CommandError::from)?;

    Ok(project)
}

/// 프로젝트 로드
#[tauri::command]
pub fn load_project(args: LoadProjectArgs, db_state: State<DbState>) -> CommandResult<IteProject> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.load_project(&args.project_id).map_err(CommandError::from)
}

/// 프로젝트 저장
#[tauri::command]
pub fn save_project(project: IteProject, db_state: State<DbState>) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.save_project(&project).map_err(CommandError::from)
}
