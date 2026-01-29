//! MCP (Model Context Protocol) 클라이언트 모듈
//!
//! Node.js 의존성 없이 Rust에서 직접 MCP 서버에 연결합니다.
//! - SSE (Server-Sent Events) 클라이언트 (Atlassian)
//! - Streamable HTTP 클라이언트 (Notion)
//! - OAuth 2.1 PKCE 인증 (Atlassian)
//! - Integration Token 인증 (Notion)
//! - MCP JSON-RPC 프로토콜 처리
//! - 여러 MCP 서버 통합 관리 (레지스트리)

pub mod client;
pub mod notion_client;
pub mod notion_oauth;
pub mod oauth;
pub mod registry;
pub mod types;

pub use client::{McpClient, MCP_CLIENT};
pub use notion_client::{NotionMcpClient, NOTION_MCP_CLIENT};
pub use notion_oauth::NotionOAuth;
pub use oauth::AtlassianOAuth;
pub use registry::{McpRegistry, McpServerId, McpServerInfo, McpRegistryStatus};
pub use types::*;

use once_cell::sync::OnceCell;
use tauri::{AppHandle, Emitter};

/// 전역 AppHandle (MCP 상태 변경 이벤트 발송용)
pub static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

/// AppHandle 초기화 (앱 시작 시 호출)
pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// MCP 상태 변경 이벤트 발송
pub fn emit_mcp_status_changed(status: &McpConnectionStatus) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("mcp-status-changed", status);
    }
}

