//! AI Usage Ledger Commands
//!
//! 모델 호출 1회(도구 루프는 루프 전체)당 토큰 사용량을 append 저장하고, 일별로 집계해 반환한다.
//! 비용 환산은 모델 단가가 프런트에 있으므로(pricing.ts) 여기서는 토큰만 다룬다.
//!
//! 사용량 기록은 번역·채팅 UX의 부산물이므로, 기록 실패가 본 작업을 막지 않도록
//! 호출부(TS)에서 best-effort로 감싼다.

use serde::Deserialize;
use tauri::State;

use super::run_db_task;
use crate::db::{AiUsageDailyRow, AiUsageRecordRow, DbState};
use crate::error::{CommandError, CommandResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogAiUsageArgs {
    pub record: AiUsageRecordRow,
}

/// 사용량 1건 append 저장. 같은 id 재전송은 멱등이다.
#[tauri::command]
pub async fn log_ai_usage(
    args: LogAiUsageArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.insert_ai_usage_record(&args.record)
            .map_err(CommandError::from)
    })
    .await
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAiUsageDailyArgs {
    /// epoch ms, 포함. None이면 하한 없음.
    pub from_ms: Option<i64>,
    /// epoch ms, 미포함. None이면 상한 없음.
    pub to_ms: Option<i64>,
}

/// 일자(로컬) + 기능 + provider + 모델 단위 집계 조회.
#[tauri::command]
pub async fn get_ai_usage_daily(
    args: GetAiUsageDailyArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<AiUsageDailyRow>> {
    run_db_task(&db_state, move |db| {
        db.query_ai_usage_daily(args.from_ms, args.to_ms)
            .map_err(CommandError::from)
    })
    .await
}

/// 사용량 기록 전체 삭제 (설정에서 사용자가 명시적으로 실행).
#[tauri::command]
pub async fn clear_ai_usage(db_state: State<'_, DbState>) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.clear_ai_usage_records().map_err(CommandError::from)
    })
    .await
}
