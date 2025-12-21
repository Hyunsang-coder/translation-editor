//! ITE Error Types
//!
//! 애플리케이션 전역 에러 타입 정의

use serde::Serialize;
use thiserror::Error;

/// ITE 애플리케이션 에러
#[derive(Error, Debug)]
pub enum IteError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Project not found: {0}")]
    ProjectNotFound(String),

    #[error("Block not found: {0}")]
    BlockNotFound(String),

    #[error("Segment not found: {0}")]
    SegmentNotFound(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
}

/// Tauri 명령 응답용 직렬화 가능한 에러
#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl From<IteError> for CommandError {
    fn from(error: IteError) -> Self {
        let code = match &error {
            IteError::Database(_) => "DB_ERROR",
            IteError::Io(_) => "IO_ERROR",
            IteError::Serialization(_) => "SERIALIZATION_ERROR",
            IteError::ProjectNotFound(_) => "PROJECT_NOT_FOUND",
            IteError::BlockNotFound(_) => "BLOCK_NOT_FOUND",
            IteError::SegmentNotFound(_) => "SEGMENT_NOT_FOUND",
            IteError::InvalidOperation(_) => "INVALID_OPERATION",
        };

        CommandError {
            code: code.to_string(),
            message: error.to_string(),
            details: None,
        }
    }
}

/// Tauri 명령 결과 타입
pub type CommandResult<T> = Result<T, CommandError>;

