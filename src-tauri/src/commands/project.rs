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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateProjectArgs {
    pub project_id: String,
}

/// 프로젝트 복제
#[tauri::command]
pub fn duplicate_project(
    args: DuplicateProjectArgs,
    db_state: State<DbState>,
) -> CommandResult<IteProject> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    let original = db.load_project(&args.project_id).map_err(CommandError::from)?;
    let now = chrono::Utc::now().timestamp_millis();
    let new_project_id = uuid::Uuid::new_v4().to_string();

    // 기존 block ID → 새 block ID 매핑
    let mut block_id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for old_id in original.blocks.keys() {
        block_id_map.insert(old_id.clone(), uuid::Uuid::new_v4().to_string());
    }

    // 블록 복제 (새 ID 발급)
    let mut new_blocks = std::collections::HashMap::new();
    for (old_id, block) in &original.blocks {
        let new_id = block_id_map[old_id].clone();
        new_blocks.insert(new_id.clone(), crate::models::EditorBlock {
            id: new_id,
            block_type: block.block_type.clone(),
            content: block.content.clone(),
            hash: block.hash.clone(),
            metadata: crate::models::BlockMetadata {
                author: block.metadata.author.clone(),
                created_at: now,
                updated_at: now,
                tags: block.metadata.tags.clone(),
                comments: block.metadata.comments.clone(),
            },
        });
    }

    // 세그먼트 복제 (새 ID + block ID 매핑)
    let new_segments: Vec<crate::models::SegmentGroup> = original.segments.iter().map(|seg| {
        crate::models::SegmentGroup {
            group_id: uuid::Uuid::new_v4().to_string(),
            source_ids: seg.source_ids.iter().map(|id| {
                block_id_map.get(id).cloned().unwrap_or_else(|| id.clone())
            }).collect(),
            target_ids: seg.target_ids.iter().map(|id| {
                block_id_map.get(id).cloned().unwrap_or_else(|| id.clone())
            }).collect(),
            is_aligned: seg.is_aligned,
            order: seg.order,
        }
    }).collect();

    let new_project = IteProject {
        id: new_project_id,
        version: original.version.clone(),
        metadata: crate::models::ProjectMetadata {
            title: format!("{} (copy)", original.metadata.title),
            description: original.metadata.description.clone(),
            domain: original.metadata.domain.clone(),
            target_language: original.metadata.target_language.clone(),
            created_at: now,
            updated_at: now,
            author: original.metadata.author.clone(),
            glossary_paths: original.metadata.glossary_paths.clone(),
            settings: original.metadata.settings.clone(),
        },
        segments: new_segments,
        blocks: new_blocks,
        history: Vec::new(),
    };

    db.save_project(&new_project).map_err(CommandError::from)?;

    // 채팅 프로젝트 설정 복제 (시스템 프롬프트, 레퍼런스 노트 등)
    if let Ok(Some(settings_json)) = db.load_chat_project_settings(&args.project_id) {
        let _ = db.save_chat_project_settings(&new_project.id, &settings_json, now);
    }

    Ok(new_project)
}
