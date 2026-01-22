//! Notion MCP 클라이언트 구현
//!
//! 로컬 Notion MCP 서버와 Streamable HTTP transport로 통신합니다.
//! (SSE가 아닌 일반 HTTP POST 요청/응답 방식)
//!
//! 사용 방법:
//! 1. 사용자가 터미널에서 `NOTION_TOKEN=ntn_xxx npx @notionhq/notion-mcp-server --transport http` 실행
//! 2. 서버가 출력한 Auth Token을 앱 설정에 입력
//! 3. 앱이 로컬 서버에 연결

use crate::mcp::notion_oauth::NotionOAuth;
use crate::mcp::types::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Notion MCP 클라이언트
pub struct NotionMcpClient {
    /// 설정 관리 핸들러
    config: Arc<NotionOAuth>,
    /// 연결 상태
    status: Arc<RwLock<McpConnectionStatus>>,
    /// 다음 요청 ID
    next_request_id: AtomicU64,
    /// 캐시된 도구 목록
    cached_tools: Arc<RwLock<Vec<McpTool>>>,
    /// 서버 정보
    server_info: Arc<RwLock<Option<ServerInfo>>>,
    /// MCP 세션 ID (서버에서 반환)
    session_id: Arc<RwLock<Option<String>>>,
}

impl NotionMcpClient {
    pub fn new() -> Self {
        Self {
            config: Arc::new(NotionOAuth::new()),
            status: Arc::new(RwLock::new(McpConnectionStatus::default())),
            next_request_id: AtomicU64::new(1),
            cached_tools: Arc::new(RwLock::new(Vec::new())),
            server_info: Arc::new(RwLock::new(None)),
            session_id: Arc::new(RwLock::new(None)),
        }
    }

    /// 현재 연결 상태 가져오기 (설정 정보 포함)
    pub async fn get_status(&self) -> McpConnectionStatus {
        let mut status = self.status.read().await.clone();

        // 설정 상태 조회
        let (has_config, _saved_at) = self.config.get_token_info().await;
        status.has_stored_token = has_config;

        status
    }

    /// 상태 업데이트
    async fn update_status(&self, update: impl FnOnce(&mut McpConnectionStatus)) {
        let mut status = self.status.write().await;
        update(&mut status);
    }

    /// MCP 설정 저장 (URL + Auth Token)
    pub async fn set_config(
        &self,
        mcp_url: Option<String>,
        auth_token: String,
    ) -> Result<(), String> {
        self.config.set_config(mcp_url, auth_token).await
    }

    /// Notion MCP 서버에 연결
    pub async fn connect(&self) -> Result<(), String> {
        // 이미 연결 중이거나 연결된 경우
        {
            let status = self.status.read().await;
            if status.is_connected || status.is_connecting {
                return Ok(());
            }
        }

        self.update_status(|s| {
            s.is_connecting = true;
            s.error = None;
        })
        .await;

        // 설정 확인
        if !self.config.has_config().await {
            self.update_status(|s| {
                s.is_connecting = false;
                s.error = Some("No Notion MCP config. Please set config first.".to_string());
            })
            .await;
            return Err("No Notion MCP config available. Run the local MCP server and set the auth token.".to_string());
        }

        let mcp_url = self.config.get_mcp_url().await;
        println!("[NotionMCP] Connecting to: {}", mcp_url);

        // MCP 초기화 수행
        match self.initialize().await {
            Ok(()) => {
                // 도구 목록 가져오기
                if let Err(e) = self.fetch_tools().await {
                    eprintln!("[NotionMCP] Failed to fetch tools: {}", e);
                }

                self.update_status(|s| {
                    s.is_connected = true;
                    s.is_connecting = false;
                    s.server_name = Some("Notion (Local)".to_string());
                })
                .await;
                Ok(())
            }
            Err(e) => {
                self.update_status(|s| {
                    s.is_connecting = false;
                    s.error = Some(e.clone());
                })
                .await;
                Err(e)
            }
        }
    }

    /// MCP 초기화 요청
    async fn initialize(&self) -> Result<(), String> {
        let params = InitializeParams {
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
            capabilities: ClientCapabilities {
                sampling: Some(serde_json::json!({})),
                roots: None,
            },
            client_info: ClientInfo {
                name: "ite-mcp-client".to_string(),
                version: "1.0.0".to_string(),
            },
        };

        let response = self
            .send_request("initialize", Some(serde_json::to_value(params).map_err(|e| e.to_string())?))
            .await?;

        if let Some(result) = response.result {
            if let Ok(init_result) = serde_json::from_value::<InitializeResult>(result) {
                *self.server_info.write().await = init_result.server_info;

                // initialized 알림 전송
                self.send_notification("notifications/initialized", None)
                    .await?;

                return Ok(());
            }
        }

        if let Some(error) = response.error {
            return Err(format!(
                "Initialize failed: {} (code: {})",
                error.message, error.code
            ));
        }

        Err("Initialize failed: unknown error".to_string())
    }

    /// 도구 목록 가져오기
    async fn fetch_tools(&self) -> Result<(), String> {
        let response = self.send_request("tools/list", None).await?;

        if let Some(result) = response.result {
            if let Ok(tools_result) = serde_json::from_value::<ListToolsResult>(result) {
                println!("[NotionMCP] Loaded {} tools", tools_result.tools.len());
                *self.cached_tools.write().await = tools_result.tools;
                return Ok(());
            }
        }

        if let Some(error) = response.error {
            return Err(format!(
                "List tools failed: {} (code: {})",
                error.message, error.code
            ));
        }

        Err("List tools failed: unknown error".to_string())
    }

    /// JSON-RPC 요청 전송 (Streamable HTTP)
    async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<JsonRpcResponse, String> {
        let mcp_url = self.config.get_mcp_url().await;
        let auth_token = self
            .config
            .get_access_token()
            .await
            .ok_or("No auth token available")?;

        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let request_body = JsonRpcRequest::new(id, method, params);

        println!("[NotionMCP] Sending request: {} (id: {}) to {}", method, id, mcp_url);

        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        // 세션 ID가 있으면 헤더에 추가
        let session_id = self.session_id.read().await.clone();

        let mut request = client
            .post(&mcp_url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .header("Content-Type", "application/json");

        if let Some(sid) = &session_id {
            request = request.header("mcp-session-id", sid.as_str());
        }

        let response = request
            .json(&request_body)
            .send()
            .await
            .map_err(|e| {
                eprintln!("[NotionMCP] HTTP request failed: {}", e);
                format!("Failed to send request: {}. Is the local MCP server running?", e)
            })?;

        println!("[NotionMCP] HTTP response status: {}", response.status());

        // 응답 헤더에서 세션 ID 추출
        if let Some(new_session_id) = response.headers().get("mcp-session-id") {
            if let Ok(sid) = new_session_id.to_str() {
                *self.session_id.write().await = Some(sid.to_string());
                println!("[NotionMCP] Session ID: {}", sid);
            }
        }

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            if status.as_u16() == 401 {
                return Err("Authentication failed. Please check your auth token.".to_string());
            }
            return Err(format!(
                "Request failed with status {}: {}",
                status, body
            ));
        }

        // 응답 본문에서 JSON-RPC 응답 파싱
        let response_text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        println!("[NotionMCP] Response: {}", &response_text[..response_text.len().min(200)]);

        // 응답이 비어있는 경우 (일부 알림 요청에 대한 응답)
        if response_text.is_empty() {
            return Ok(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: Some(serde_json::Value::Number(id.into())),
                result: Some(serde_json::json!({})),
                error: None,
            });
        }

        serde_json::from_str::<JsonRpcResponse>(&response_text)
            .map_err(|e| format!("Failed to parse response: {} - {}", e, response_text))
    }

    /// JSON-RPC 알림 전송 (응답 없음)
    async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let mcp_url = self.config.get_mcp_url().await;
        let auth_token = self
            .config
            .get_access_token()
            .await
            .ok_or("No auth token available")?;

        let notification = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };

        println!("[NotionMCP] Sending notification: {}", method);

        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let session_id = self.session_id.read().await.clone();

        let mut request = client
            .post(&mcp_url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .header("Content-Type", "application/json");

        if let Some(sid) = &session_id {
            request = request.header("mcp-session-id", sid.as_str());
        }

        let response = request
            .json(&notification)
            .send()
            .await
            .map_err(|e| format!("Failed to send notification: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Notification failed with status {}: {}",
                status, body
            ));
        }

        Ok(())
    }

    /// 도구 목록 가져오기 (캐시된 값)
    pub async fn get_tools(&self) -> Vec<McpTool> {
        self.cached_tools.read().await.clone()
    }

    /// 도구 호출
    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<McpToolResult, String> {
        let params = CallToolParams {
            name: name.to_string(),
            arguments,
        };

        let response = self
            .send_request("tools/call", Some(serde_json::to_value(params).map_err(|e| e.to_string())?))
            .await?;

        if let Some(result) = response.result {
            return serde_json::from_value(result)
                .map_err(|e| format!("Failed to parse tool result: {}", e));
        }

        if let Some(error) = response.error {
            return Err(format!(
                "Tool call failed: {} (code: {})",
                error.message, error.code
            ));
        }

        Err("Tool call failed: unknown error".to_string())
    }

    /// 연결 해제
    pub async fn disconnect(&self) {
        // 상태 초기화
        *self.cached_tools.write().await = Vec::new();
        *self.server_info.write().await = None;
        *self.session_id.write().await = None;

        self.update_status(|s| {
            s.is_connected = false;
            s.is_connecting = false;
            s.server_name = None;
        })
        .await;
    }

    /// 로그아웃 (설정 삭제 포함)
    pub async fn logout(&self) {
        self.disconnect().await;
        self.config.logout().await;
    }

    /// 완전 초기화 (설정 모두 삭제)
    /// 복구 불가능한 상태일 때 사용
    pub async fn clear_all(&self) {
        self.disconnect().await;
        self.config.clear_all().await;
    }
}

impl Default for NotionMcpClient {
    fn default() -> Self {
        Self::new()
    }
}

// 전역 싱글톤 인스턴스
use once_cell::sync::Lazy;

pub static NOTION_MCP_CLIENT: Lazy<NotionMcpClient> = Lazy::new(NotionMcpClient::new);
