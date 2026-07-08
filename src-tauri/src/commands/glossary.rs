//! Glossary Commands
//!
//! 로컬 글로서리(CSV) 임포트 및 검색 API
//! 임포트는 파일 파싱 + 배치 insert로 무거울 수 있어 async + `run_db_task`로 실행한다.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::run_db_task;
use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::utils::{validate_file_size, validate_path};

/// 글로서리 파일 최대 크기 (10MB)
const MAX_GLOSSARY_SIZE: u64 = 10 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGlossaryCsvArgs {
    pub project_id: String,
    /// CSV 파일 경로(로컬 파일 시스템)
    pub path: String,
    /// true면 프로젝트 범위의 기존 엔트리를 모두 삭제 후 임포트
    pub replace_project_scope: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGlossaryResult {
    pub inserted: u32,
    pub updated: u32,
    pub skipped: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGlossaryExcelArgs {
    pub project_id: String,
    /// Excel 파일 경로(.xlsx/.xls)
    pub path: String,
    /// true면 프로젝트 범위의 기존 엔트리를 모두 삭제 후 임포트
    pub replace_project_scope: Option<bool>,
}

/// CSV 글로서리 임포트
#[tauri::command]
pub async fn import_glossary_csv(
    args: ImportGlossaryCsvArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ImportGlossaryResult> {
    // 경로 검증 (시스템 디렉토리 접근 차단)
    let validated_path = validate_path(&args.path)?;

    validate_file_size(&validated_path, MAX_GLOSSARY_SIZE)?;

    run_db_task(&db_state, move |db| {
        let replace = args.replace_project_scope.unwrap_or(false);
        let (inserted, updated, skipped, warnings) = db
            .import_glossary_csv(
                &args.project_id,
                validated_path.to_string_lossy().as_ref(),
                replace,
            )
            .map_err(CommandError::from)?;

        Ok(ImportGlossaryResult {
            inserted,
            updated,
            skipped,
            warnings,
        })
    })
    .await
}

/// Excel(.xlsx/.xls) 글로서리 임포트
#[tauri::command]
pub async fn import_glossary_excel(
    args: ImportGlossaryExcelArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ImportGlossaryResult> {
    // 경로 검증 (시스템 디렉토리 접근 차단)
    let validated_path = validate_path(&args.path)?;

    validate_file_size(&validated_path, MAX_GLOSSARY_SIZE)?;

    run_db_task(&db_state, move |db| {
        let replace = args.replace_project_scope.unwrap_or(false);
        let (inserted, updated, skipped, warnings) = db
            .import_glossary_excel(
                &args.project_id,
                validated_path.to_string_lossy().as_ref(),
                replace,
            )
            .map_err(CommandError::from)?;

        Ok(ImportGlossaryResult {
            inserted,
            updated,
            skipped,
            warnings,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchGlossaryArgs {
    pub project_id: String,
    pub query: String,
    pub limit: Option<u32>,
    pub domain: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntryDto {
    pub id: String,
    pub source: String,
    pub target: String,
    pub notes: Option<String>,
    pub domain: Option<String>,
    pub case_sensitive: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 글로서리 검색(비벡터, rule-based)
#[tauri::command]
pub async fn search_glossary(
    args: SearchGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<GlossaryEntryDto>> {
    run_db_task(&db_state, move |db| {
        let limit = args.limit.unwrap_or(12).min(50);
        let rows = db
            .search_glossary_in_text(&args.project_id, &args.query, args.domain.as_deref(), limit)
            .map_err(CommandError::from)?;

        Ok(rows
            .into_iter()
            .map(|r| GlossaryEntryDto {
                id: r.id,
                source: r.source,
                target: r.target,
                notes: r.notes,
                domain: r.domain,
                case_sensitive: r.case_sensitive,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect())
    })
    .await
}
