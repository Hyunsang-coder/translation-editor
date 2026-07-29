//! Tauri Commands Module
//!
//! 프론트엔드에서 호출 가능한 Tauri 명령어 정의

use crate::db::{Database, DbState};
use crate::error::{CommandError, CommandResult};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, MutexGuard};
use tauri::State;
use tokio::sync::Notify;

/// DB lock 획득 헬퍼: 5줄 보일러플레이트를 1줄로 축소
///
/// 주의: 이 헬퍼는 호출한 스레드에서 락을 잡는다. 동기 커맨드는 Tauri v2에서
/// 메인 스레드에서 실행되므로, 무겁거나 자주 불리는 DB 커맨드는 이 헬퍼 대신
/// `run_db_task`(async + spawn_blocking)를 사용할 것.
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

/// DB 작업을 blocking 스레드풀로 이관하는 헬퍼.
///
/// Tauri v2에서 동기 커맨드는 메인 스레드에서 실행되므로, DB 작업(특히 backup/export,
/// blocks 전량 delete+insert)이 메인 스레드와 이벤트 루프 전체를 얼릴 수 있다.
/// 이 헬퍼는 `DbState`의 Arc를 clone해 `spawn_blocking` 클로저 안으로 move하고,
/// std Mutex 락도 클로저 안에서만 잡는다 (MutexGuard를 await 너머로 보유 금지).
pub async fn run_db_task<T, F>(db_state: &State<'_, DbState>, task: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Database) -> CommandResult<T> + Send + 'static,
{
    let db = Arc::clone(&db_state.0);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = db.lock().map_err(|e| CommandError {
            code: "LOCK_ERROR".to_string(),
            message: format!("Failed to acquire database lock: {}", e),
            details: None,
        })?;
        task(&mut guard)
    })
    .await
    .map_err(|e| CommandError {
        code: "TASK_JOIN_ERROR".to_string(),
        message: format!("Database task failed to complete: {}", e),
        details: None,
    })?
}

/// 스트리밍 취소 신호 핸들.
///
/// AtomicBool 플래그(루프 상단 검사용)와 tokio `Notify`(대기 중 즉시 깨우기용)를 함께 보관한다.
/// `chunk().await` 같은 장기 대기를 `tokio::select!`로 감싸면 취소가 즉시 반영된다.
pub struct CancelHandle {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelHandle {
    pub fn new() -> Self {
        Self {
            flag: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    /// 취소 신호를 보낸다 (대기 중인 select! 지점을 즉시 깨움)
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// 취소될 때까지 대기한다 (이미 취소된 경우 즉시 반환).
    pub async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            // Notified future를 먼저 만들어 두고 플래그를 재확인해야
            // cancel()과의 사이에서 알림을 놓치지 않는다.
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

impl Default for CancelHandle {
    fn default() -> Self {
        Self::new()
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
pub mod project_memory;
pub mod secrets;
pub mod secure_store;
pub mod storage;
pub mod usage;

#[cfg(test)]
mod cancel_handle_tests {
    use super::CancelHandle;
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn cancel_wakes_waiters_immediately() {
        let handle = Arc::new(CancelHandle::new());
        let waiter = {
            let h = Arc::clone(&handle);
            tokio::spawn(async move {
                h.cancelled().await;
            })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        handle.cancel();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("waiter should wake after cancel")
            .expect("waiter task should not panic");
    }

    #[tokio::test]
    async fn cancelled_returns_immediately_if_already_cancelled() {
        let handle = CancelHandle::new();
        handle.cancel();
        tokio::time::timeout(Duration::from_millis(100), handle.cancelled())
            .await
            .expect("should return immediately when already cancelled");
        assert!(handle.is_cancelled());
    }
}
