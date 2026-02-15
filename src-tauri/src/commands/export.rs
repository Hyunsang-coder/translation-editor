//! Export Commands
//!
//! 번역 문서를 외부 파일(Markdown, HTML)로 내보내는 커맨드

use crate::error::{CommandError, CommandResult};
use crate::utils::validate_path;

/// UTF-8 텍스트를 파일로 저장
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> CommandResult<()> {
    let validated = validate_path(&path)?;

    std::fs::write(&validated, content.as_bytes()).map_err(|e| CommandError {
        code: "IO_ERROR".to_string(),
        message: format!("Failed to write file: {}", e),
        details: Some(validated.display().to_string()),
    })
}

/// 바이너리 데이터를 파일로 저장 (DOCX 등)
#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> CommandResult<()> {
    let validated = validate_path(&path)?;

    std::fs::write(&validated, &data).map_err(|e| CommandError {
        code: "IO_ERROR".to_string(),
        message: format!("Failed to write binary file: {}", e),
        details: Some(validated.display().to_string()),
    })
}
