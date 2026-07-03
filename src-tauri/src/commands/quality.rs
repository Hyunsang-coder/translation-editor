//! Quality Ledger Commands
//!
//! 품질 장부(설계서 §4) 영속화 API.
//! 파이프라인이 만든 모든 지적·수정·판정(quality_record)과 스테이지 실행 기록(quality_run)을 저장/조회한다.
//! 장부는 파이프라인의 부산물이므로, 기록 실패가 번역·리뷰 UX를 막지 않도록 호출부(TS)에서 best-effort로 감싼다.

use serde::Deserialize;
use tauri::State;

use super::AcquireDb;
use crate::db::{DbState, QualityRecordFilter, QualityRecordRow, QualityRunRow};
use crate::error::{CommandError, CommandResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQualityRecordsArgs {
    pub project_id: String,
    pub records: Vec<QualityRecordRow>,
}

/// 품질 레코드 append 저장. 저장된 개수를 반환한다.
#[tauri::command]
pub fn log_quality_records(
    args: LogQualityRecordsArgs,
    db_state: State<DbState>,
) -> CommandResult<usize> {
    let mut db = db_state.acquire()?;
    let count = db
        .insert_quality_records(&args.project_id, &args.records)
        .map_err(CommandError::from)?;
    Ok(count)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetQualityRecordsArgs {
    pub project_id: String,
    #[serde(default)]
    pub filter: QualityRecordFilter,
}

/// 필터 조건으로 품질 레코드 조회 (설계서 §4.7 #2).
#[tauri::command]
pub fn get_quality_records(
    args: GetQualityRecordsArgs,
    db_state: State<DbState>,
) -> CommandResult<Vec<QualityRecordRow>> {
    let db = db_state.acquire()?;
    let rows = db
        .query_quality_records(&args.project_id, &args.filter)
        .map_err(CommandError::from)?;
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQualityDispositionArgs {
    pub project_id: String,
    pub ids: Vec<String>,
    pub disposition: String,
}

/// 레코드들의 disposition 갱신 (proposed → accepted/rejected/superseded). 갱신된 행 수 반환.
#[tauri::command]
pub fn update_quality_disposition(
    args: UpdateQualityDispositionArgs,
    db_state: State<DbState>,
) -> CommandResult<usize> {
    let mut db = db_state.acquire()?;
    let updated = db
        .update_quality_records_disposition(&args.project_id, &args.ids, &args.disposition)
        .map_err(CommandError::from)?;
    Ok(updated)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQualityRunArgs {
    pub project_id: String,
    pub run: QualityRunRow,
}

/// 작업 기록(quality_run) 저장.
#[tauri::command]
pub fn log_quality_run(args: LogQualityRunArgs, db_state: State<DbState>) -> CommandResult<()> {
    let db = db_state.acquire()?;
    db.insert_quality_run(&args.project_id, &args.run)
        .map_err(CommandError::from)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadQualityRunsArgs {
    pub project_id: String,
}

/// 프로젝트별 작업 기록 조회.
#[tauri::command]
pub fn load_quality_runs(
    args: LoadQualityRunsArgs,
    db_state: State<DbState>,
) -> CommandResult<Vec<QualityRunRow>> {
    let db = db_state.acquire()?;
    let rows = db
        .load_quality_runs(&args.project_id)
        .map_err(CommandError::from)?;
    Ok(rows)
}
