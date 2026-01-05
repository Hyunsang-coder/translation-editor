//! Notion REST API 연동 모듈
//!
//! Notion REST API를 직접 호출하여 페이지 검색, 조회 등을 수행합니다.
//! MCP 프로토콜 대신 직접 API 호출 방식을 사용합니다.

pub mod client;
pub mod types;

pub use client::NotionClient;
pub use client::NOTION_CLIENT;

