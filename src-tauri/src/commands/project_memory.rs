//! Structured project memory and forbidden-term commands.
//!
//! AI tools only create proposals. These commands are called after explicit user
//! approval (or for idempotent legacy migration) and persist project-scoped data.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::run_db_task;
use crate::db::{DbState, ForbiddenTermRow, ProjectMemoryItemRow};
use crate::error::{CommandError, CommandResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryProjectArgs {
    pub project_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemorySnapshotDto {
    pub project_id: String,
    pub items: Vec<ProjectMemoryItemRow>,
    pub forbidden_terms: Vec<ForbiddenTermRow>,
    pub revision: i64,
}

#[tauri::command]
pub async fn load_project_memory(
    args: ProjectMemoryProjectArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ProjectMemorySnapshotDto> {
    run_db_task(&db_state, move |db| {
        let (items, forbidden_terms, revision) = db
            .load_project_memory(&args.project_id)
            .map_err(CommandError::from)?;
        Ok(ProjectMemorySnapshotDto {
            project_id: args.project_id,
            items,
            forbidden_terms,
            revision,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectMemoryItemArgs {
    pub project_id: String,
    pub category: String,
    pub content: String,
    pub status: String,
    pub source: String,
    pub source_session_id: Option<String>,
    pub source_message_id: Option<String>,
    pub source_selection_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectMemoryItemResult {
    pub item: ProjectMemoryItemRow,
    pub revision: i64,
    pub duplicate: bool,
}

#[tauri::command]
pub async fn add_project_memory_item(
    args: AddProjectMemoryItemArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<AddProjectMemoryItemResult> {
    run_db_task(&db_state, move |db| {
        let (item, revision, duplicate) = db
            .add_project_memory_item(
                &args.project_id,
                &args.category,
                &args.content,
                &args.status,
                &args.source,
                args.source_session_id.as_deref(),
                args.source_message_id.as_deref(),
                args.source_selection_id.as_deref(),
            )
            .map_err(CommandError::from)?;
        Ok(AddProjectMemoryItemResult {
            item,
            revision,
            duplicate,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceProjectMemoryItemArgs {
    pub project_id: String,
    pub target_item_id: String,
    pub category: String,
    pub content: String,
    pub source: String,
    pub source_session_id: Option<String>,
    pub source_message_id: Option<String>,
    pub source_selection_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceProjectMemoryItemResult {
    pub item: ProjectMemoryItemRow,
    pub revision: i64,
}

#[tauri::command]
pub async fn replace_project_memory_item(
    args: ReplaceProjectMemoryItemArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ReplaceProjectMemoryItemResult> {
    run_db_task(&db_state, move |db| {
        let (item, revision) = db
            .replace_project_memory_item(
                &args.project_id,
                &args.target_item_id,
                &args.category,
                &args.content,
                &args.source,
                args.source_session_id.as_deref(),
                args.source_message_id.as_deref(),
                args.source_selection_id.as_deref(),
            )
            .map_err(CommandError::from)?;
        Ok(ReplaceProjectMemoryItemResult { item, revision })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectMemoryItemArgs {
    pub project_id: String,
    pub item_id: String,
}

#[tauri::command]
pub async fn delete_project_memory_item(
    args: DeleteProjectMemoryItemArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ProjectMemoryRevisionResult> {
    run_db_task(&db_state, move |db| {
        let revision = db
            .delete_project_memory_item(&args.project_id, &args.item_id)
            .map_err(CommandError::from)?;
        Ok(ProjectMemoryRevisionResult { revision })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertForbiddenTermArgs {
    pub project_id: String,
    pub id: Option<String>,
    pub term: String,
    pub replacement: Option<String>,
    pub note: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertForbiddenTermResult {
    pub term: ForbiddenTermRow,
    pub revision: i64,
}

#[tauri::command]
pub async fn upsert_forbidden_term(
    args: UpsertForbiddenTermArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<UpsertForbiddenTermResult> {
    run_db_task(&db_state, move |db| {
        let (term, revision) = db
            .upsert_forbidden_term(
                &args.project_id,
                args.id.as_deref(),
                &args.term,
                args.replacement.as_deref(),
                args.note.as_deref(),
                args.enabled,
            )
            .map_err(CommandError::from)?;
        Ok(UpsertForbiddenTermResult { term, revision })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteForbiddenTermArgs {
    pub project_id: String,
    pub id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryRevisionResult {
    pub revision: i64,
}

#[tauri::command]
pub async fn delete_forbidden_term(
    args: DeleteForbiddenTermArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ProjectMemoryRevisionResult> {
    run_db_task(&db_state, move |db| {
        let revision = db
            .delete_forbidden_term(&args.project_id, &args.id)
            .map_err(CommandError::from)?;
        Ok(ProjectMemoryRevisionResult { revision })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateLegacyProjectMemoryArgs {
    pub project_id: String,
    pub content: String,
}

#[tauri::command]
pub async fn migrate_legacy_project_memory(
    args: MigrateLegacyProjectMemoryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<bool> {
    run_db_task(&db_state, move |db| {
        db.migrate_legacy_project_memory(&args.project_id, &args.content)
            .map_err(CommandError::from)
    })
    .await
}
