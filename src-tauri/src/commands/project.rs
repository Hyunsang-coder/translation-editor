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
    #[serde(rename = "sourceLanguage")]
    pub source_language: String,
    #[serde(rename = "targetLanguage")]
    pub target_language: String,
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

    let project = IteProject {
        id: project_id.clone(),
        version: "1.0.0".to_string(),
        metadata: crate::models::ProjectMetadata {
            title: args.title,
            description: None,
            source_language: args.source_language,
            target_language: args.target_language,
            domain: args.domain,
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
        segments: Vec::new(),
        blocks: std::collections::HashMap::new(),
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

