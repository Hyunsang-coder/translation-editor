//! MCP 서버 레지스트리
//!
//! 여러 MCP 서버(Atlassian 등)를 통합 관리합니다.

use crate::mcp::client::MCP_CLIENT;
use crate::mcp::types::{McpConnectionStatus, McpTool, McpToolResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 지원되는 MCP 서버 타입
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpServerId {
    Atlassian,
}

impl McpServerId {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpServerId::Atlassian => "atlassian",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            McpServerId::Atlassian => "Atlassian Confluence",
        }
    }
}

/// MCP 서버 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    pub id: McpServerId,
    pub display_name: String,
    pub description: String,
    pub icon: String,
    pub status: McpConnectionStatus,
}

/// 전체 MCP 상태 요약
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistryStatus {
    pub servers: Vec<McpServerInfo>,
    pub connected_count: usize,
    pub has_any_token: bool,
}

/// MCP 레지스트리
///
/// 모든 MCP 서버의 상태를 추적하고 통합 관리합니다.
pub struct McpRegistry;

impl McpRegistry {
    /// 지원되는 모든 MCP 서버 목록
    pub fn supported_servers() -> Vec<McpServerId> {
        vec![McpServerId::Atlassian]
    }

    /// 특정 MCP 서버에 연결
    pub async fn connect(server_id: McpServerId) -> Result<(), String> {
        match server_id {
            McpServerId::Atlassian => MCP_CLIENT.connect().await,
        }
    }

    /// 특정 MCP 서버 연결 해제
    pub async fn disconnect(server_id: McpServerId) {
        match server_id {
            McpServerId::Atlassian => {
                MCP_CLIENT.disconnect().await;
            }
        }
    }

    /// 특정 MCP 서버 로그아웃 (토큰 삭제)
    pub async fn logout(server_id: McpServerId) {
        match server_id {
            McpServerId::Atlassian => {
                MCP_CLIENT.logout().await;
            }
        }
    }

    /// 특정 MCP 서버 완전 초기화 (토큰 + 클라이언트 정보 모두 삭제)
    /// Client ID mismatch 등 복구 불가능한 상태일 때 사용
    pub async fn clear_all(server_id: McpServerId) {
        match server_id {
            McpServerId::Atlassian => {
                MCP_CLIENT.clear_all().await;
            }
        }
    }

    /// 특정 MCP 서버 상태 조회
    pub async fn get_status(server_id: McpServerId) -> McpConnectionStatus {
        match server_id {
            McpServerId::Atlassian => MCP_CLIENT.get_status().await,
        }
    }

    /// 전체 레지스트리 상태 조회
    pub async fn get_registry_status() -> McpRegistryStatus {
        let mut servers = Vec::new();
        let mut connected_count = 0;
        let mut has_any_token = false;

        for server_id in Self::supported_servers() {
            let status = Self::get_status(server_id).await;

            if status.is_connected {
                connected_count += 1;
            }
            if status.has_stored_token {
                has_any_token = true;
            }

            servers.push(McpServerInfo {
                id: server_id,
                display_name: server_id.display_name().to_string(),
                description: match server_id {
                    McpServerId::Atlassian => "Confluence 페이지 검색 및 조회".to_string(),
                },
                icon: match server_id {
                    McpServerId::Atlassian => "🔗".to_string(),
                },
                status,
            });
        }

        McpRegistryStatus {
            servers,
            connected_count,
            has_any_token,
        }
    }

    /// 특정 MCP 서버의 도구 목록 조회
    pub async fn get_tools(server_id: McpServerId) -> Vec<McpTool> {
        match server_id {
            McpServerId::Atlassian => MCP_CLIENT.get_tools().await,
        }
    }

    /// 연결된 모든 MCP 서버의 도구 목록 조회
    pub async fn get_all_tools() -> HashMap<McpServerId, Vec<McpTool>> {
        let mut all_tools = HashMap::new();

        for server_id in Self::supported_servers() {
            let status = Self::get_status(server_id).await;
            if status.is_connected {
                let tools = Self::get_tools(server_id).await;
                if !tools.is_empty() {
                    all_tools.insert(server_id, tools);
                }
            }
        }

        all_tools
    }

    /// MCP 도구 호출
    pub async fn call_tool(
        server_id: McpServerId,
        name: &str,
        arguments: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<McpToolResult, String> {
        match server_id {
            McpServerId::Atlassian => MCP_CLIENT.call_tool(name, arguments).await,
        }
    }

    /// 도구 이름으로 해당 MCP 서버 찾기
    pub async fn find_server_for_tool(tool_name: &str) -> Option<McpServerId> {
        for server_id in Self::supported_servers() {
            let tools = Self::get_tools(server_id).await;
            if tools.iter().any(|t| t.name == tool_name) {
                return Some(server_id);
            }
        }
        None
    }
}
