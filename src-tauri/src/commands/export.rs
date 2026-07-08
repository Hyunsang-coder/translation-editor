//! Export Commands
//!
//! 번역 문서를 외부 파일(Markdown, HTML)로 내보내는 커맨드
//! 파일 I/O는 spawn_blocking으로 이관해 메인 스레드를 점유하지 않는다.

use crate::error::{CommandError, CommandResult};
use crate::utils::validate_path;

fn join_error(e: impl std::fmt::Display) -> CommandError {
    CommandError {
        code: "TASK_JOIN_ERROR".to_string(),
        message: format!("File task failed to complete: {}", e),
        details: None,
    }
}

/// UTF-8 텍스트를 파일로 저장
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> CommandResult<()> {
    let validated = validate_path(&path)?;

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&validated, content.as_bytes()).map_err(|e| CommandError {
            code: "IO_ERROR".to_string(),
            message: format!("Failed to write file: {}", e),
            details: Some(validated.display().to_string()),
        })
    })
    .await
    .map_err(join_error)?
}

/// UTF-8 텍스트 파일 읽기
#[tauri::command]
pub async fn read_text_file(path: String) -> CommandResult<String> {
    let validated = validate_path(&path)?;

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_to_string(&validated).map_err(|e| CommandError {
            code: "IO_ERROR".to_string(),
            message: format!("Failed to read file: {}", e),
            details: Some(validated.display().to_string()),
        })
    })
    .await
    .map_err(join_error)?
}

/// 바이너리 데이터를 파일로 저장 (DOCX 등)
#[tauri::command]
pub async fn write_binary_file(path: String, data: Vec<u8>) -> CommandResult<()> {
    let validated = validate_path(&path)?;

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&validated, &data).map_err(|e| CommandError {
            code: "IO_ERROR".to_string(),
            message: format!("Failed to write binary file: {}", e),
            details: Some(validated.display().to_string()),
        })
    })
    .await
    .map_err(join_error)?
}
