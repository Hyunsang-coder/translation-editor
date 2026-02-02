//! MCP SSE 클라이언트 구현
//!
//! Atlassian MCP 서버와 SSE(Server-Sent Events)로 통신합니다.

use crate::mcp::oauth::AtlassianOAuth;
use crate::mcp::types::*;
use crate::mcp::emit_mcp_status_changed;
use futures::StreamExt;
use rand::Rng;
use reqwest_eventsource::{Event, EventSource};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

const MCP_SSE_URL: &str = "https://mcp.atlassian.com/v1/sse";
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// MCP 클라이언트
pub struct McpClient {
    /// OAuth 인증 핸들러
    oauth: Arc<AtlassianOAuth>,
    /// 연결 상태
    status: Arc<RwLock<McpConnectionStatus>>,
    /// 메시지 전송용 엔드포인트 (SSE 연결 후 받음)
    message_endpoint: Arc<RwLock<Option<String>>>,
    /// 대기 중인 응답 (request id -> response channel)
    pending_requests: Arc<Mutex<HashMap<String, oneshot::Sender<JsonRpcResponse>>>>,
    /// 다음 요청 ID
    next_request_id: AtomicU64,
    /// SSE 연결 종료용
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
    /// 캐시된 도구 목록
    cached_tools: Arc<RwLock<Vec<McpTool>>>,
    /// 서버 정보
    server_info: Arc<RwLock<Option<ServerInfo>>>,
}

impl McpClient {
    pub fn new() -> Self {
        Self {
            oauth: Arc::new(AtlassianOAuth::new()),
            status: Arc::new(RwLock::new(McpConnectionStatus::default())),
            message_endpoint: Arc::new(RwLock::new(None)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            next_request_id: AtomicU64::new(1),
            shutdown_tx: Arc::new(Mutex::new(None)),
            cached_tools: Arc::new(RwLock::new(Vec::new())),
            server_info: Arc::new(RwLock::new(None)),
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

        println!("[MCP] connect() called");

        // 이미 연결 중이거나 연결된 경우
        {
            let status = self.status.read().await;
            if status.is_connected || status.is_connecting {
                println!("[MCP] Already connected or connecting, skipping");
                return Ok(());
            }
        }

        self.update_status(|s| {
            s.is_connecting = true;
            s.error = None;
        }).await;

        // OAuth 토큰 확인 (재시도 대상 아님 - 사용자 인터랙션 필요)
        println!("[MCP] Checking OAuth token...");
        if !self.oauth.has_token().await {
            println!("[MCP] No token found, starting OAuth flow...");
            match self.oauth.start_auth_flow().await {
                Ok(msg) => {
                    println!("[MCP] OAuth flow completed successfully: {}", msg);
                }
                Err(e) => {
                    println!("[MCP] OAuth flow failed: {}", e);
                    self.update_status(|s| {
                        s.is_connecting = false;
                        s.error = Some(e.clone());
                    }).await;
                    return Err(e);
                }
            }
        } else {
            println!("[MCP] Token already exists");
        }

        // SSE 연결 및 초기화 (지수 백오프로 재시도)
        let mut attempt = 0u32;
        loop {
            match self.connect_inner().await {
                Ok(()) => {
                    self.update_status(|s| {
                        s.is_connected = true;
                        s.is_connecting = false;
                        s.server_name = Some("Atlassian".to_string());
                    }).await;
                    return Ok(());
                }
                Err(e) if attempt < MAX_RETRY_ATTEMPTS => {
                    // Exponential backoff: 1s, 2s, 4s, 8s, 16s... max 30s
                    let base_delay_ms = 1000u64 * (1u64 << attempt);
                    let jitter_ms = rand::thread_rng().gen_range(0..1000);
                    let delay_ms = std::cmp::min(base_delay_ms + jitter_ms, 30000);

                    println!(
                        "[MCP] Connection attempt {} failed: {}. Retrying in {}ms...",
                        attempt + 1,
                        e,
                        delay_ms
                    );

                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    attempt += 1;
                }
                Err(e) => {
                    let error_msg = format!(
                        "Connection failed after {} attempts: {}",
                        attempt + 1,
                        e
                    );
                    println!("[MCP] {}", error_msg);
                    self.update_status(|s| {
                        s.is_connecting = false;
                        s.error = Some(error_msg.clone());
                    }).await;
                    return Err(error_msg);
                }
            }
        }
    }

    /// SSE 연결 및 MCP 초기화 수행 (내부 구현)
    async fn connect_inner(&self) -> Result<(), String> {
        println!("[MCP] Starting SSE connection...");

        match self.start_sse_connection().await {
            Ok(()) => {
                // MCP 초기화 수행
                match self.initialize().await {
                    Ok(()) => {
                        // 도구 목록 가져오기
                        if let Err(e) = self.fetch_tools().await {
                            eprintln!("[MCP] Failed to fetch tools: {}", e);
                        }
                        Ok(())
                    }
                    Err(e) => {
                        self.disconnect().await;
                        Err(e)
                    }
                }
            }
            Err(e) => Err(e),
        }
    }

    /// SSE 연결 시작
    async fn start_sse_connection(&self) -> Result<(), String> {
        let access_token = self.oauth.get_access_token().await
            .ok_or("No access token available")?;

        println!("[MCP] Starting SSE connection to: {}", MCP_SSE_URL);
        println!("[MCP] Access token: [REDACTED] (length: {})", access_token.len());

        // reqwest 클라이언트 빌드 (TLS 설정 포함)
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        
        let request = client
            .get(MCP_SSE_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache");

        let mut es = EventSource::new(request)
            .map_err(|e| format!("Failed to create EventSource: {}", e))?;

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);

        let message_endpoint = self.message_endpoint.clone();
        let pending_requests = self.pending_requests.clone();
        let status = self.status.clone();

        // SSE 이벤트 처리 태스크
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    event = es.next() => {
                        match event {
                            Some(Ok(Event::Open)) => {
                                println!("[MCP] SSE connection opened");
                            }
                            Some(Ok(Event::Message(msg))) => {
                                // SSE 이벤트 타입에 따라 처리
                                match msg.event.as_str() {
                                    "endpoint" => {
                                        // 메시지 전송 엔드포인트 수신
                                        // 상대 경로인 경우 절대 URL로 변환
                                        let endpoint_url = if msg.data.starts_with("http://") || msg.data.starts_with("https://") {
                                            msg.data.clone()
                                        } else {
                                            // 상대 경로를 SSE URL 기준으로 절대 URL로 변환
                                            match url::Url::parse(MCP_SSE_URL) {
                                                Ok(base_url) => {
                                                    match base_url.join(&msg.data) {
                                                        Ok(full_url) => full_url.to_string(),
                                                        Err(_) => format!("https://mcp.atlassian.com{}", msg.data)
                                                    }
                                                }
                                                Err(_) => format!("https://mcp.atlassian.com{}", msg.data)
                                            }
                                        };
                                        println!("[MCP] Received endpoint: {} -> {}", msg.data, endpoint_url);
                                        *message_endpoint.write().await = Some(endpoint_url);
                                    }
                                    "message" => {
                                        // JSON-RPC 응답 수신
                                        if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&msg.data) {
                                            if let Some(id) = &response.id {
                                                let id_str = match id {
                                                    serde_json::Value::Number(n) => n.to_string(),
                                                    serde_json::Value::String(s) => s.clone(),
                                                    _ => continue,
                                                };
                                                if let Some(tx) = pending_requests.lock().await.remove(&id_str) {
                                                    let _ = tx.send(response);
                                                }
                                            }
                                        }
                                    }
                                    _ => {
                                        println!("[MCP] Unknown SSE event: {} - {}", msg.event, msg.data);
                                    }
                                }
                            }
                            Some(Err(e)) => {
                                eprintln!("[MCP] SSE error: {}", e);
                                let mut s = status.write().await;
                                s.error = Some(format!("SSE error: {}", e));
                                emit_mcp_status_changed(&s);
                                break;
                            }
                            None => {
                                println!("[MCP] SSE stream ended");
                                break;
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        println!("[MCP] Shutting down SSE connection");
                        es.close();
                        break;
                    }
                }
            }

            // 연결 종료 시 상태 업데이트 및 이벤트 발송
            let mut s = status.write().await;
            s.is_connected = false;
            s.is_connecting = false;
            emit_mcp_status_changed(&s);
            println!("[MCP] SSE disconnected, event emitted to frontend");
        });

        // 엔드포인트 수신 대기 (최대 10초)
        for _ in 0..100 {
            if self.message_endpoint.read().await.is_some() {
                return Ok(());
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // 타임아웃 시 SSE 태스크 종료
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(()).await;
            println!("[MCP] Sent shutdown signal due to endpoint timeout");
        }

        Err("Timeout waiting for message endpoint".to_string())
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

        let response = self.send_request("initialize", Some(serde_json::to_value(params).map_err(|e| e.to_string())?)).await?;
        
        if let Some(result) = response.result {
            if let Ok(init_result) = serde_json::from_value::<InitializeResult>(result) {
                *self.server_info.write().await = init_result.server_info;
                
                // initialized 알림 전송
                self.send_notification("notifications/initialized", None).await?;
                
                return Ok(());
            }
        }

        if let Some(error) = response.error {
            return Err(format!("Initialize failed: {} (code: {})", error.message, error.code));
        }

        Err("Initialize failed: unknown error".to_string())
    }

    /// 도구 목록 가져오기
    async fn fetch_tools(&self) -> Result<(), String> {
        let response = self.send_request("tools/list", None).await?;
        
        if let Some(result) = response.result {
            if let Ok(tools_result) = serde_json::from_value::<ListToolsResult>(result) {
                *self.cached_tools.write().await = tools_result.tools;
                return Ok(());
            }
        }

        if let Some(error) = response.error {
            return Err(format!("List tools failed: {} (code: {})", error.message, error.code));
        }

        Err("List tools failed: unknown error".to_string())
    }

    /// JSON-RPC 요청 전송
    async fn send_request(&self, method: &str, params: Option<serde_json::Value>) -> Result<JsonRpcResponse, String> {
        let endpoint = self.message_endpoint.read().await.clone()
            .ok_or("Not connected to MCP server")?;

        println!("[MCP] Sending request to endpoint: {}", endpoint);
        println!("[MCP] Method: {}", method);

        let access_token = self.oauth.get_access_token().await
            .ok_or("No access token available")?;

        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let request_body = JsonRpcRequest::new(id, method, params);

        // 응답 채널 등록
        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().await.insert(id.to_string(), tx);

        // HTTP POST로 요청 전송
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        
        let response = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        if !response.status().is_success() {
            self.pending_requests.lock().await.remove(&id.to_string());
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Request failed with status {}: {}", status, body));
        }

        // SSE를 통한 응답 대기 (타임아웃: 30초)
        match tokio::time::timeout(tokio::time::Duration::from_secs(30), rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err("Response channel closed".to_string()),
            Err(_) => {
                self.pending_requests.lock().await.remove(&id.to_string());
                Err("Request timeout".to_string())
            }
        }
    }

    /// JSON-RPC 알림 전송 (응답 없음)
    async fn send_notification(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), String> {
        let endpoint = self.message_endpoint.read().await.clone()
            .ok_or("Not connected to MCP server")?;

        let access_token = self.oauth.get_access_token().await
            .ok_or("No access token available")?;

        let notification = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };

        println!("[MCP] Sending notification: {}", method);

        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        
        let response = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&notification)
            .send()
            .await
            .map_err(|e| format!("Failed to send notification: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Notification failed with status {}: {}", status, body));
        }

        Ok(())
    }

    /// 도구 목록 가져오기 (캐시된 값)
    pub async fn get_tools(&self) -> Vec<McpTool> {
        self.cached_tools.read().await.clone()
    }

    /// 도구 호출
    pub async fn call_tool(&self, name: &str, arguments: Option<HashMap<String, serde_json::Value>>) -> Result<McpToolResult, String> {
        let params = CallToolParams {
            name: name.to_string(),
            arguments,
        };

        let response = self.send_request("tools/call", Some(serde_json::to_value(params).map_err(|e| e.to_string())?)).await?;

        if let Some(result) = response.result {
            return serde_json::from_value(result)
                .map_err(|e| format!("Failed to parse tool result: {}", e));
        }

        if let Some(error) = response.error {
            return Err(format!("Tool call failed: {} (code: {})", error.message, error.code));
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
        // SSE 연결 종료
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(()).await;
        }

        // 상태 초기화
        *self.message_endpoint.write().await = None;
        self.pending_requests.lock().await.clear();
        *self.cached_tools.write().await = Vec::new();
        *self.server_info.write().await = None;

        self.update_status(|s| {
            s.is_connected = false;
            s.is_connecting = false;
            s.server_name = None;
        }).await;
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

