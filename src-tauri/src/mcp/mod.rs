//! MCP (Model Context Protocol) SSE 클라이언트 모듈
//! 
//! Node.js 의존성 없이 Rust에서 직접 Atlassian MCP 서버에 연결합니다.
//! - SSE (Server-Sent Events) 클라이언트
//! - OAuth 2.1 PKCE 인증
//! - MCP JSON-RPC 프로토콜 처리

pub mod client;
pub mod oauth;
pub mod types;

pub use client::{McpClient, MCP_CLIENT};
pub use oauth::AtlassianOAuth;
pub use types::*;

