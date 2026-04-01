//! MCP Streamable HTTP 클라이언트 구현
//!
//! Atlassian MCP 서버와 Streamable HTTP transport로 통신합니다.
//! (SSE 방식은 2026-06-30 폐기 예정 → Streamable HTTP로 마이그레이션)

use crate::mcp::emit_mcp_status_changed;
use crate::mcp::oauth::AtlassianOAuth;
use crate::mcp::types::*;
use rand::Rng;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

const MCP_ENDPOINT_URL: &str = "https://mcp.atlassian.com/v1/mcp";
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// MCP 클라이언트
pub struct McpClient {
    /// OAuth 인증 핸들러
    oauth: Arc<AtlassianOAuth>,
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
    /// HTTP 클라이언트 (재사용)
    http: reqwest::Client,
}

impl McpClient {
    pub fn new() -> Self {
        Self {
            oauth: Arc::new(AtlassianOAuth::new()),
            status: Arc::new(RwLock::new(McpConnectionStatus::default())),
            next_request_id: AtomicU64::new(1),
            cached_tools: Arc::new(RwLock::new(Vec::new())),
            server_info: Arc::new(RwLock::new(None)),
            session_id: Arc::new(RwLock::new(None)),
            http: reqwest::Client::new(),
        }
    }

    /// 현재 연결 상태 가져오기 (토큰 정보 포함)
    pub async fn get_status(&self) -> McpConnectionStatus {
        let mut status = self.status.read().await.clone();

        // OAuth 초기화 및 토큰 상태 조회
        let (has_token, expires_in) = self.oauth.get_token_info().await;
        status.has_stored_token = has_token;
        status.token_expires_in = expires_in;

        status
    }

    /// 상태 업데이트 및 프론트엔드에 이벤트 발송
    async fn update_status(&self, update: impl FnOnce(&mut McpConnectionStatus)) {
        let mut status = self.status.write().await;
        update(&mut status);
        // 프론트엔드에 상태 변경 이벤트 발송
        emit_mcp_status_changed(&status);
    }

    /// Atlassian MCP 서버에 연결 (지수 백오프 재시도 포함)
    pub async fn connect(&self) -> Result<(), String> {
        const MAX_RETRY_ATTEMPTS: u32 = 5;

        debug!("[MCP] connect() called");

        // 이미 연결 중이거나 연결된 경우
        {
            let status = self.status.read().await;
            if status.is_connected || status.is_connecting {
                debug!("[MCP] Already connected or connecting, skipping");
                return Ok(());
            }
        }

        self.update_status(|s| {
            s.is_connecting = true;
            s.error = None;
        })
        .await;

        // OAuth 토큰 확인 (재시도 대상 아님 - 사용자 인터랙션 필요)
        debug!("[MCP] Checking OAuth token...");
        if !self.oauth.has_token().await {
            info!("[MCP] No token found, starting OAuth flow...");
            match self.oauth.start_auth_flow().await {
                Ok(msg) => {
                    info!("[MCP] OAuth flow completed successfully: {}", msg);
                }
                Err(e) => {
                    warn!("[MCP] OAuth flow failed: {}", e);
                    self.update_status(|s| {
                        s.is_connecting = false;
                        s.error = Some(e.clone());
                    })
                    .await;
                    return Err(e);
                }
            }
        } else {
            debug!("[MCP] Token already exists");
        }

        // MCP 초기화 (지수 백오프로 재시도)
        let mut attempt = 0u32;
        loop {
            match self.connect_inner().await {
                Ok(()) => {
                    self.update_status(|s| {
                        s.is_connected = true;
                        s.is_connecting = false;
                        s.server_name = Some("Atlassian".to_string());
                    })
                    .await;
                    return Ok(());
                }
                Err(e) if attempt < MAX_RETRY_ATTEMPTS => {
                    // Exponential backoff: 1s, 2s, 4s, 8s, 16s... max 30s
                    let base_delay_ms = 1000u64 * (1u64 << attempt);
                    let jitter_ms = rand::thread_rng().gen_range(0..1000);
                    let delay_ms = std::cmp::min(base_delay_ms + jitter_ms, 30000);

                    warn!(
                        "[MCP] Connection attempt {} failed: {}. Retrying in {}ms...",
                        attempt + 1,
                        e,
                        delay_ms
                    );

                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    attempt += 1;
                }
                Err(e) => {
                    let error_msg =
                        format!("Connection failed after {} attempts: {}", attempt + 1, e);
                    error!("[MCP] {}", error_msg);
                    self.update_status(|s| {
                        s.is_connecting = false;
                        s.error = Some(error_msg.clone());
                    })
                    .await;
                    return Err(error_msg);
                }
            }
        }
    }

    /// MCP 초기화 및 도구 가져오기 (내부 구현)
    async fn connect_inner(&self) -> Result<(), String> {
        debug!("[MCP] Starting MCP initialization via Streamable HTTP...");

        // MCP 초기화 수행
        self.initialize().await?;

        // 도구 목록 가져오기
        if let Err(e) = self.fetch_tools().await {
            warn!("[MCP] Failed to fetch tools: {}", e);
        }

        Ok(())
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
            .send_request(
                "initialize",
                Some(serde_json::to_value(params).map_err(|e| e.to_string())?),
            )
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
                info!("[MCP] Loaded {} tools", tools_result.tools.len());
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
        let access_token = self
            .oauth
            .get_access_token()
            .await
            .ok_or("No access token available")?;

        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let request_body = JsonRpcRequest::new(id, method, params);

        debug!(
            "[MCP] Sending request: {} (id: {}) to {}",
            method, id, MCP_ENDPOINT_URL
        );

        // 세션 ID가 있으면 헤더에 추가
        let session_id = self.session_id.read().await.clone();

        let mut request = self
            .http
            .post(MCP_ENDPOINT_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");

        if let Some(sid) = &session_id {
            request = request.header("mcp-session-id", sid.as_str());
        }

        let response = request.json(&request_body).send().await.map_err(|e| {
            error!("[MCP] HTTP request failed: {}", e);
            format!("Failed to send request: {}", e)
        })?;

        debug!("[MCP] HTTP response status: {}", response.status());

        // 응답 헤더에서 세션 ID 추출
        if let Some(new_session_id) = response.headers().get("mcp-session-id") {
            if let Ok(sid) = new_session_id.to_str() {
                *self.session_id.write().await = Some(sid.to_string());
                debug!("[MCP] Session ID: {}", sid);
            }
        }

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            if status.as_u16() == 401 {
                return Err(
                    "Authentication failed. Token may be expired — please reconnect.".to_string(),
                );
            }
            return Err(format!("Request failed with status {}: {}", status, body));
        }

        // Content-Type에 따라 파싱 분기
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let response_text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        debug!(
            "[MCP] Response ({}): {}",
            content_type,
            &response_text[..response_text.len().min(200)]
        );

        // 응답이 비어있는 경우 (일부 알림 요청에 대한 응답)
        if response_text.is_empty() {
            return Ok(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: Some(serde_json::Value::Number(id.into())),
                result: Some(serde_json::json!({})),
                error: None,
            });
        }

        // SSE 형식 응답인 경우 data 필드에서 JSON 추출
        if content_type.contains("text/event-stream") {
            return Self::parse_sse_response(&response_text);
        }

        serde_json::from_str::<JsonRpcResponse>(&response_text)
            .map_err(|e| format!("Failed to parse response: {} - {}", e, response_text))
    }

    /// SSE 형식 응답에서 JSON-RPC 응답 추출
    ///
    /// Streamable HTTP 서버가 text/event-stream으로 응답할 경우,
    /// `event: message\ndata: {...}\n\n` 형식에서 마지막 data 라인의 JSON을 파싱한다.
    fn parse_sse_response(body: &str) -> Result<JsonRpcResponse, String> {
        // SSE 이벤트에서 마지막 "data:" 라인 추출
        let json_str = body
            .lines()
            .rev()
            .find_map(|line| line.strip_prefix("data:").map(|d| d.trim()))
            .ok_or_else(|| format!("No data field in SSE response: {}", &body[..body.len().min(200)]))?;

        serde_json::from_str::<JsonRpcResponse>(json_str)
            .map_err(|e| format!("Failed to parse SSE data as JSON-RPC: {} - {}", e, json_str))
    }

    /// JSON-RPC 알림 전송 (응답 없음)
    async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let access_token = self
            .oauth
            .get_access_token()
            .await
            .ok_or("No access token available")?;

        let notification = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };

        debug!("[MCP] Sending notification: {}", method);

        let session_id = self.session_id.read().await.clone();

        let mut request = self
            .http
            .post(MCP_ENDPOINT_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");

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
            .send_request(
                "tools/call",
                Some(serde_json::to_value(params).map_err(|e| e.to_string())?),
            )
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

    /// OAuth 액세스 토큰 가져오기 (REST API 직접 호출용)
    /// MCP 연결 없이도 토큰만 가져올 수 있음
    pub async fn get_oauth_token(&self) -> Option<String> {
        self.oauth.get_access_token().await
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

    /// 로그아웃 (토큰 삭제 포함)
    pub async fn logout(&self) {
        self.disconnect().await;
        self.oauth.logout().await;
    }

    /// 완전 초기화 (토큰 + OAuth 클라이언트 모두 삭제)
    /// Client ID mismatch 등 복구 불가능한 상태일 때 사용
    pub async fn clear_all(&self) {
        self.disconnect().await;
        self.oauth.clear_all().await;
    }
}

impl Default for McpClient {
    fn default() -> Self {
        Self::new()
    }
}

// 전역 싱글톤 인스턴스
use once_cell::sync::Lazy;

pub static MCP_CLIENT: Lazy<McpClient> = Lazy::new(McpClient::new);
