//! Tauri Commands Module
//!
//! 프론트엔드에서 호출 가능한 Tauri 명령어 정의

use crate::db::{Database, DbState};
use crate::error::{CommandError, CommandResult};
use std::sync::MutexGuard;
use tauri::State;

/// DB lock 획득 헬퍼 — 5줄 보일러플레이트를 1줄로 축소
pub trait AcquireDb {
    fn acquire(&self) -> CommandResult<MutexGuard<'_, Database>>;
}

impl AcquireDb for State<'_, DbState> {
    fn acquire(&self) -> CommandResult<MutexGuard<'_, Database>> {
        self.0.lock().map_err(|e| CommandError {
            code: "LOCK_ERROR".to_string(),
            message: format!("Failed to acquire database lock: {}", e),
            details: None,
        })
    }
}

pub mod ai;
pub mod attachments;
pub mod block;
pub mod chat;
pub mod comments;
pub mod confluence;
pub mod connector;
pub mod export;
pub mod glossary;
pub mod history;
pub mod http_proxy;
pub mod mcp;
pub mod notion;
pub mod project;
pub mod quality;
pub mod secrets;
pub mod secure_store;
pub mod storage;
