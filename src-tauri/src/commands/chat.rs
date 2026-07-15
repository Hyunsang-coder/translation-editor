//! Chat Persistence Commands
//!
//! 프로젝트별 채팅 세션 및 ChatPanel 설정을 DB에 저장/로드합니다.
//! 모든 커맨드는 async + `run_db_task`(spawn_blocking)로 실행되어 메인 스레드를 점유하지 않는다.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::run_db_task;
use crate::db::DbState;
use crate::error::{CommandError, CommandResult, IteError};
use crate::models::ChatSession;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProjectSettings {
    /// Deprecated: migrated into translation_rules on load. Kept for JSON compat.
    #[serde(default, alias = "systemPromptOverlay")]
    pub translator_persona: String,
    pub translation_rules: String,
    pub project_context: String,
    pub composer_text: String,
    #[serde(default)]
    pub web_search_enabled: bool,
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
pub struct SaveChatSessionsArgs {
    pub project_id: String,
    pub sessions: Vec<ChatSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadChatSessionsArgs {
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
pub async fn save_current_chat_session(
    args: SaveCurrentChatSessionArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.save_current_chat_session(&args.project_id, &args.session)
            .map_err(CommandError::from)
    })
    .await
}

/// 프로젝트별 현재 채팅 세션(1개) 로드
#[tauri::command]
pub async fn load_current_chat_session(
    args: LoadCurrentChatSessionArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Option<ChatSession>> {
    run_db_task(&db_state, move |db| {
        db.load_current_chat_session(&args.project_id)
            .map_err(CommandError::from)
    })
    .await
}

/// 프로젝트별 채팅 세션(최대 3개) 저장
#[tauri::command]
pub async fn save_chat_sessions(
    args: SaveChatSessionsArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.save_chat_sessions(&args.project_id, &args.sessions)
            .map_err(CommandError::from)
    })
    .await
}

/// 프로젝트별 채팅 세션(최대 3개) 로드 (최근 활동 기준)
#[tauri::command]
pub async fn load_chat_sessions(
    args: LoadChatSessionsArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<ChatSession>> {
    run_db_task(&db_state, move |db| {
        db.load_chat_sessions(&args.project_id)
            .map_err(CommandError::from)
    })
    .await
}

/// 프로젝트별 채팅 설정 저장
#[tauri::command]
pub async fn save_chat_project_settings(
    args: SaveChatSettingsArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let json =
        serde_json::to_string(&args.settings).map_err(|e| CommandError::from(IteError::from(e)))?;

    run_db_task(&db_state, move |db| {
        db.save_chat_project_settings(&args.project_id, &json, now)
            .map_err(CommandError::from)
    })
    .await
}

/// 프로젝트별 채팅 설정 로드
#[tauri::command]
pub async fn load_chat_project_settings(
    args: LoadChatSettingsArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Option<ChatProjectSettings>> {
    let json = run_db_task(&db_state, move |db| {
        db.load_chat_project_settings(&args.project_id)
            .map_err(CommandError::from)
    })
    .await?;

    if let Some(s) = json {
        let parsed = serde_json::from_str::<ChatProjectSettings>(&s)
            .map_err(|e| CommandError::from(IteError::from(e)))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}
