//! Chat Persistence Commands
//!
//! 프로젝트별 "현재 세션 1개" 및 ChatPanel 설정을 DB에 저장/로드합니다.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::error::{CommandError, CommandResult, IteError};
use crate::models::ChatSession;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProjectSettings {
    #[serde(alias = "systemPromptOverlay")]
    pub translator_persona: String,
    pub translation_rules: String,
    #[serde(default, alias = "activeMemory")]
    pub project_context: String,
    pub composer_text: String,
    pub translation_context_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCurrentChatSessionArgs {
    pub project_id: String,
    pub session: ChatSession,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadCurrentChatSessionArgs {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChatSettingsArgs {
    pub project_id: String,
    pub settings: ChatProjectSettings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadChatSettingsArgs {
    pub project_id: String,
}

/// 프로젝트별 현재 채팅 세션(1개) 저장
#[tauri::command]
pub fn save_current_chat_session(
    args: SaveCurrentChatSessionArgs,
    db_state: State<DbState>,
) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.save_current_chat_session(&args.project_id, &args.session)
        .map_err(CommandError::from)?;
    Ok(())
}

/// 프로젝트별 현재 채팅 세션(1개) 로드
#[tauri::command]
pub fn load_current_chat_session(
    args: LoadCurrentChatSessionArgs,
    db_state: State<DbState>,
) -> CommandResult<Option<ChatSession>> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    db.load_current_chat_session(&args.project_id)
        .map_err(CommandError::from)
}

/// 프로젝트별 채팅 설정 저장
#[tauri::command]
pub fn save_chat_project_settings(
    args: SaveChatSettingsArgs,
    db_state: State<DbState>,
) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    let now = chrono::Utc::now().timestamp_millis();
    let json = serde_json::to_string(&args.settings).map_err(|e| CommandError::from(IteError::from(e)))?;
    db.save_chat_project_settings(&args.project_id, &json, now)
        .map_err(CommandError::from)?;
    Ok(())
}

/// 프로젝트별 채팅 설정 로드
#[tauri::command]
pub fn load_chat_project_settings(
    args: LoadChatSettingsArgs,
    db_state: State<DbState>,
) -> CommandResult<Option<ChatProjectSettings>> {
    let db = db_state.0.lock().map_err(|e| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: format!("Failed to acquire database lock: {}", e),
        details: None,
    })?;

    let json = db
        .load_chat_project_settings(&args.project_id)
        .map_err(CommandError::from)?;
    if let Some(s) = json {
        let parsed = serde_json::from_str::<ChatProjectSettings>(&s)
            .map_err(|e| CommandError::from(IteError::from(e)))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}


