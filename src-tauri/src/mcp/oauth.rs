//! Atlassian MCP OAuth 2.1 PKCE 인증 구현
//! 
//! Atlassian MCP 서버는 자체 OAuth 엔드포인트를 제공합니다.
//! (auth.atlassian.com이 아닌 mcp.atlassian.com 사용)
//! 
//! 토큰은 SecretManager vault에 영속화되어 앱 재시작 후에도 유지됩니다.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use url::Url;

use crate::secrets::SECRETS;

// Atlassian MCP 서버 자체 OAuth 엔드포인트
const MCP_AUTH_URL: &str = "https://mcp.atlassian.com/v1/authorize";
const MCP_TOKEN_URL: &str = "https://cf.mcp.atlassian.com/v1/token";
const MCP_REGISTRATION_URL: &str = "https://cf.mcp.atlassian.com/v1/register";
const REDIRECT_PORT: u16 = 23456;

// Vault 저장 키 (SecretManager용)
const VAULT_MCP_TOKEN: &str = "mcp/atlassian/oauth_token_json";
const VAULT_MCP_CLIENT: &str = "mcp/atlassian/client_json";

// 토큰 만료 전 갱신 여유 시간 (5분)
const TOKEN_REFRESH_MARGIN_SECS: i64 = 300;

/// OAuth 토큰 (영속화 가능)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: Option<i64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
    /// 토큰 발급 시점 (Unix timestamp, 초)
    #[serde(default)]
    pub issued_at: i64,
}

impl OAuthToken {
    /// 토큰이 만료되었는지 (또는 곧 만료될지) 확인
    pub fn is_expired(&self) -> bool {
        if let Some(expires_in) = self.expires_in {
            let now = chrono::Utc::now().timestamp();
            let expires_at = self.issued_at + expires_in;
            // 만료 5분 전부터 갱신 필요
            now >= expires_at - TOKEN_REFRESH_MARGIN_SECS
        } else {
            // expires_in이 없으면 만료되지 않은 것으로 간주
            false
        }
    }

    /// 남은 유효 시간 (초)
    pub fn remaining_seconds(&self) -> Option<i64> {
        self.expires_in.map(|exp| {
            let now = chrono::Utc::now().timestamp();
            let expires_at = self.issued_at + exp;
            (expires_at - now).max(0)
        })
    }
}

/// Dynamic Client Registration 응답
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ClientRegistrationResponse {
    client_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_id_issued_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_secret_expires_at: Option<i64>,
}

/// 등록된 클라이언트 정보 (영속화 가능)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct RegisteredClient {
    client_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_secret: Option<String>,
}

/// PKCE 검증 데이터
#[derive(Debug)]
struct PkceData {
    code_verifier: String,
    state: String,
}

/// Atlassian MCP OAuth 핸들러
pub struct AtlassianOAuth {
    /// 현재 토큰 (있는 경우)
    token: Arc<Mutex<Option<OAuthToken>>>,
    /// 동적으로 등록된 클라이언트 정보
    registered_client: Arc<Mutex<Option<RegisteredClient>>>,
    /// 진행 중인 OAuth 세션
    pending_pkce: Arc<Mutex<Option<PkceData>>>,
    /// OAuth 콜백 수신용
    callback_tx: Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
    /// 콜백 서버 종료 signal
    callback_shutdown_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<()>>>>,
    /// 초기화 완료 여부
    initialized: Arc<Mutex<bool>>,
}

impl AtlassianOAuth {
    pub fn new() -> Self {
        Self {
            token: Arc::new(Mutex::new(None)),
            registered_client: Arc::new(Mutex::new(None)),
            pending_pkce: Arc::new(Mutex::new(None)),
            callback_tx: Arc::new(Mutex::new(None)),
            callback_shutdown_tx: Arc::new(Mutex::new(None)),
            initialized: Arc::new(Mutex::new(false)),
        }
    }

    /// SecretManager에서 저장된 토큰/클라이언트 로드 (앱 시작 시 호출)
    pub async fn initialize(&self) -> Result<(), String> {
        let mut initialized = self.initialized.lock().await;
        if *initialized {
            return Ok(());
        }

        println!("[OAuth] Initializing from SecretManager vault...");

        // 저장된 클라이언트 로드
        if let Ok(Some(client_json)) = SECRETS.get(VAULT_MCP_CLIENT).await {
            if let Ok(client) = serde_json::from_str::<RegisteredClient>(&client_json) {
                println!("[OAuth] Loaded client_id from vault: {}", client.client_id);
                *self.registered_client.lock().await = Some(client);
            }
        }

        // 저장된 토큰 로드
        if let Ok(Some(token_json)) = SECRETS.get(VAULT_MCP_TOKEN).await {
            if let Ok(token) = serde_json::from_str::<OAuthToken>(&token_json) {
                if let Some(remaining) = token.remaining_seconds() {
                    println!("[OAuth] Loaded token from vault (expires in {} seconds)", remaining);
                }
                *self.token.lock().await = Some(token);
            }
        }

        *initialized = true;
        Ok(())
    }

    /// 토큰 저장 (메모리 + vault)
    async fn save_token(&self, token: OAuthToken) -> Result<(), String> {
        let token_json = serde_json::to_string(&token)
            .map_err(|e| format!("Failed to serialize token: {}", e))?;
        
        SECRETS
            .set(VAULT_MCP_TOKEN, &token_json)
            .await
            .map_err(|e| format!("Failed to save token: {}", e))?;
        *self.token.lock().await = Some(token);
        
        println!("[OAuth] Token saved to vault");
        Ok(())
    }

    /// 클라이언트 저장 (메모리 + vault)
    async fn save_client(&self, client: RegisteredClient) -> Result<(), String> {
        let client_json = serde_json::to_string(&client)
            .map_err(|e| format!("Failed to serialize client: {}", e))?;
        
        SECRETS
            .set(VAULT_MCP_CLIENT, &client_json)
            .await
            .map_err(|e| format!("Failed to save client: {}", e))?;
        *self.registered_client.lock().await = Some(client);
        
        println!("[OAuth] Client saved to vault");
        Ok(())
    }

    /// 현재 토큰이 있는지 확인 (자동 초기화 포함)
    pub async fn has_token(&self) -> bool {
        let _ = self.initialize().await;
        self.token.lock().await.is_some()
    }

    /// 유효한 액세스 토큰 가져오기 (필요 시 자동 갱신)
    pub async fn get_access_token(&self) -> Option<String> {
        let _ = self.initialize().await;
        
        // 토큰 확인
        let needs_refresh = {
            let token = self.token.lock().await;
            match token.as_ref() {
                Some(t) => t.is_expired(),
                None => return None,
            }
        };

        // 만료된 경우 갱신 시도
        if needs_refresh {
            println!("[OAuth] Token expired, attempting refresh...");
            match self.refresh_token().await {
                Ok(()) => println!("[OAuth] Token refreshed successfully"),
                Err(e) => {
                    eprintln!("[OAuth] Token refresh failed: {}", e);
                    // 갱신 실패 시 기존 토큰 반환 (만료되었더라도)
                }
            }
        }

        self.token.lock().await.as_ref().map(|t| t.access_token.clone())
    }

    /// PKCE code_verifier 생성
    fn generate_code_verifier() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
        URL_SAFE_NO_PAD.encode(&bytes)
    }

    /// code_verifier에서 code_challenge 생성 (S256)
    fn generate_code_challenge(verifier: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let hash = hasher.finalize();
        URL_SAFE_NO_PAD.encode(hash)
    }

    /// 랜덤 state 생성
    fn generate_state() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        URL_SAFE_NO_PAD.encode(&bytes)
    }

    /// Dynamic Client Registration
    async fn register_client(&self) -> Result<RegisteredClient, String> {
        let _ = self.initialize().await;
        
        // 이미 등록된 클라이언트가 있으면 재사용
        if let Some(client) = self.registered_client.lock().await.clone() {
            println!("[OAuth] Reusing existing client: {}", client.client_id);
            return Ok(client);
        }

        let redirect_uri = format!("http://localhost:{}/callback", REDIRECT_PORT);
        
        let registration_request = serde_json::json!({
            "client_name": "OddEyes.ai",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none"
        });

        println!("[OAuth] Registering OAuth client...");
        
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        
        let response = client
            .post(MCP_REGISTRATION_URL)
            .header("Content-Type", "application/json")
            .json(&registration_request)
            .send()
            .await
            .map_err(|e| format!("Client registration request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let body_preview = if body.len() > 200 { &body[..200] } else { &body };
            return Err(format!("Client registration failed with status {}: {}", status, body_preview));
        }

        let reg_response: ClientRegistrationResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse registration response: {}", e))?;

        println!("[OAuth] Client registered: {}", reg_response.client_id);

        let registered = RegisteredClient {
            client_id: reg_response.client_id,
            client_secret: reg_response.client_secret,
        };

        // vault에 저장
        self.save_client(registered.clone()).await?;
        
        Ok(registered)
    }

    /// OAuth 인증 플로우 시작
    pub async fn start_auth_flow(&self) -> Result<String, String> {
        let registered_client = self.register_client().await?;

        let code_verifier = Self::generate_code_verifier();
        let code_challenge = Self::generate_code_challenge(&code_verifier);
        let state = Self::generate_state();

        *self.pending_pkce.lock().await = Some(PkceData {
            code_verifier: code_verifier.clone(),
            state: state.clone(),
        });

        let redirect_uri = format!("http://localhost:{}/callback", REDIRECT_PORT);
        let auth_url = format!(
            "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
            MCP_AUTH_URL,
            urlencoding::encode(&registered_client.client_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode("offline_access"),
            state,
            code_challenge
        );

        println!("[OAuth] Authorization URL: {}", auth_url);

        let (tx, rx) = oneshot::channel();
        *self.callback_tx.lock().await = Some(tx);

        let callback_tx = self.callback_tx.clone();
        let pending_pkce = self.pending_pkce.clone();
        let token_storage = self.token.clone();
        let client_id = registered_client.client_id.clone();
        
        // 콜백 서버 shutdown 채널 생성
        let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);
        *self.callback_shutdown_tx.lock().await = Some(shutdown_tx);
        
        tokio::spawn(async move {
            if let Err(e) = Self::run_callback_server(REDIRECT_PORT, callback_tx, pending_pkce, token_storage, client_id, shutdown_rx).await {
                eprintln!("[OAuth] Callback server error: {}", e);
            }
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        if let Err(e) = open::that(&auth_url) {
            // 브라우저 열기 실패 시 콜백 서버 즉시 종료
            self.shutdown_callback_server().await;
            return Err(format!("Failed to open browser: {}", e));
        }

        println!("[OAuth] Waiting for OAuth callback (max 5 minutes)...");
        
        let auth_result = match tokio::time::timeout(tokio::time::Duration::from_secs(300), rx).await {
            Ok(Ok(result)) => {
                println!("[OAuth] Callback received: {:?}", result);
                // 인증 성공 시 토큰을 vault에 저장
                if result.is_ok() {
                    // lock scope를 분리하여 데드락 방지
                    // (save_token 내부에서 다시 lock을 잡기 때문)
                    let token_opt = {
                        self.token.lock().await.clone()
                    };
                    
                    if let Some(token) = token_opt {
                        if let Err(e) = self.save_token(token).await {
                            eprintln!("[OAuth] Failed to save token: {}", e);
                        } else {
                            println!("[OAuth] Token persisted to vault");
                        }
                    } else {
                        eprintln!("[OAuth] Warning: callback succeeded but no token in memory!");
                    }
                }
                result
            }
            Ok(Err(_)) => {
                self.shutdown_callback_server().await;
                Err("OAuth callback channel closed".to_string())
            }
            Err(_) => {
                // 타임아웃 시 콜백 서버 종료
                self.shutdown_callback_server().await;
                Err("OAuth timeout (5 minutes)".to_string())
            }
        };
        
        println!("[OAuth] start_auth_flow returning: {:?}", auth_result);
        auth_result
    }

    /// 콜백 서버 종료
    async fn shutdown_callback_server(&self) {
        if let Some(tx) = self.callback_shutdown_tx.lock().await.take() {
            let _ = tx.send(()).await;
            println!("[OAuth] Sent shutdown signal to callback server");
        }
    }

    /// 로컬 콜백 서버 실행
    /// 
    /// shutdown signal 수신 시 또는 6분 자체 타임아웃 시 종료됨
    async fn run_callback_server(
        port: u16,
        callback_tx: Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
        pending_pkce: Arc<Mutex<Option<PkceData>>>,
        token_storage: Arc<Mutex<Option<OAuthToken>>>,
        client_id: String,
        mut shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    ) -> Result<(), String> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::TcpListener;

        // 서버 자체 타임아웃 (OAuth 흐름 타임아웃 + 여유)
        const SERVER_TIMEOUT_SECS: u64 = 360; // 6분

        let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .map_err(|e| format!("Failed to bind callback server: {}", e))?;

        println!("[OAuth] Callback server listening on port {} (timeout: {}s)", port, SERVER_TIMEOUT_SECS);

        let server_start = std::time::Instant::now();

        // /callback 요청이 올 때까지 연결을 계속 수락 (shutdown signal 또는 타임아웃 시 종료)
        loop {
            // 서버 타임아웃 체크
            if server_start.elapsed().as_secs() >= SERVER_TIMEOUT_SECS {
                println!("[OAuth] Callback server timeout, shutting down");
                return Err("Callback server timeout".to_string());
            }

            // accept + shutdown signal 동시 대기
            let stream_result = tokio::select! {
                _ = shutdown_rx.recv() => {
                    println!("[OAuth] Callback server received shutdown signal");
                    return Ok(());
                }
                accept_result = tokio::time::timeout(
                    tokio::time::Duration::from_secs(5),
                    listener.accept()
                ) => {
                    match accept_result {
                        Ok(Ok((s, a))) => Some((s, a)),
                        Ok(Err(e)) => return Err(format!("Failed to accept connection: {}", e)),
                        Err(_) => None, // 타임아웃, 다음 루프
                    }
                }
            };

            let (stream, addr) = match stream_result {
                Some(v) => v,
                None => continue,
            };

            println!("[OAuth] Accepted connection from {}", addr);

            // 읽기/쓰기 분리 (BufReader와 write_all 충돌 방지)
            let (reader_half, mut writer_half) = stream.into_split();
            let mut reader = BufReader::new(reader_half);
            
            // HTTP 요청 라인 읽기
            let mut request_line = String::new();
            if let Err(e) = reader.read_line(&mut request_line).await {
                eprintln!("[OAuth] Failed to read request line: {}", e);
                continue;
            }

            println!("[OAuth] Received request line: {:?}", request_line.trim());

            // HTTP 헤더 모두 읽기 (빈 줄까지)
            loop {
                let mut header_line = String::new();
                match reader.read_line(&mut header_line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        if header_line.trim().is_empty() {
                            break; // 헤더 종료
                        }
                    }
                    Err(_) => break,
                }
            }

            // 요청 경로 추출
            let path = match request_line.split_whitespace().nth(1) {
                Some(p) => p.to_string(),
                None => {
                    eprintln!("[OAuth] Invalid HTTP request format");
                    let error_resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = writer_half.write_all(error_resp.as_bytes()).await;
                    let _ = writer_half.shutdown().await;
                    continue;
                }
            };

            println!("[OAuth] Request path: {}", path);

            // /callback 경로가 아닌 요청은 404 응답 후 다음 연결 대기
            if !path.starts_with("/callback") {
                println!("[OAuth] Ignoring non-callback request: {}", path);
                let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = writer_half.write_all(not_found.as_bytes()).await;
                let _ = writer_half.shutdown().await;
                continue; // 다음 연결 대기
            }

            // /callback 요청 처리
            let result = if let Ok(url) = Url::parse(&format!("http://localhost{}", path)) {
                let params: HashMap<_, _> = url.query_pairs().collect();
                
                if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
                    let pkce_data = pending_pkce.lock().await.take();
                    if let Some(pkce) = pkce_data {
                        if &pkce.state == state.as_ref() {
                            match Self::exchange_code_for_token(
                                code,
                                &pkce.code_verifier,
                                port,
                                &client_id,
                            ).await {
                                Ok(mut token) => {
                                    // 발급 시점 기록
                                    token.issued_at = chrono::Utc::now().timestamp();
                                    println!("[OAuth] Token stored in memory, issued_at: {}", token.issued_at);
                                    *token_storage.lock().await = Some(token);
                                    Ok("OAuth authentication successful".to_string())
                                }
                                Err(e) => {
                                    eprintln!("[OAuth] Token exchange error: {}", e);
                                    Err(format!("Token exchange failed: {}", e))
                                }
                            }
                        } else {
                            Err("Invalid OAuth state".to_string())
                        }
                    } else {
                        Err("No pending OAuth session".to_string())
                    }
                } else if let Some(error) = params.get("error") {
                    let error_desc = params.get("error_description")
                        .map(|d| format!(": {}", d))
                        .unwrap_or_default();
                    Err(format!("OAuth error: {}{}", error, error_desc))
                } else {
                    Err("Invalid callback parameters".to_string())
                }
            } else {
                Err("Failed to parse callback URL".to_string())
            };

            // 응답 생성
            let (status, body) = match &result {
                Ok(msg) => ("200 OK", format!(
                    r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Success</title></head>
                    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f4f5f7;">
                    <div style="background: white; padding: 40px; border-radius: 8px; max-width: 400px; margin: 0 auto; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h1 style="color: #36B37E; margin-bottom: 16px;">✓ {}</h1>
                    <p style="color: #42526e;">You can close this window and return to the app.</p>
                    </div></body></html>"#,
                    msg
                )),
                Err(msg) => ("400 Bad Request", format!(
                    r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head>
                    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f4f5f7;">
                    <div style="background: white; padding: 40px; border-radius: 8px; max-width: 400px; margin: 0 auto; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h1 style="color: #FF5630; margin-bottom: 16px;">✗ Error</h1>
                    <p style="color: #42526e;">{}</p>
                    </div></body></html>"#,
                    msg
                )),
            };

            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                body.len(),
                body
            );

            let _ = writer_half.write_all(response.as_bytes()).await;
            let _ = writer_half.shutdown().await;

            // 결과 전송 후 서버 종료
            if let Some(tx) = callback_tx.lock().await.take() {
                let _ = tx.send(result);
            }

            return Ok(());
        }
    }

    /// Authorization code를 토큰으로 교환
    async fn exchange_code_for_token(
        code: &str,
        code_verifier: &str,
        port: u16,
        client_id: &str,
    ) -> Result<OAuthToken, String> {
        let redirect_uri = format!("http://localhost:{}/callback", port);
        
        println!("[OAuth] Exchanging code for token...");
        
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        
        let params = [
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", code_verifier),
        ];

        println!("[OAuth] Sending token request to: {}", MCP_TOKEN_URL);
        
        let response = client
            .post(MCP_TOKEN_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Token request failed: {}", e))?;

        println!("[OAuth] Token response status: {}", response.status());

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Token endpoint returned {}: {}", status, body));
        }

        let token = response
            .json::<OAuthToken>()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;
        
        println!("[OAuth] Token exchange successful, access_token length: {}", token.access_token.len());
        Ok(token)
    }

    /// 토큰 갱신
    pub async fn refresh_token(&self) -> Result<(), String> {
        let current_token = self.token.lock().await.clone();
        let registered = self.registered_client.lock().await.clone();
        
        let refresh_token = current_token
            .and_then(|t| t.refresh_token)
            .ok_or("No refresh token available")?;

        let client_id = registered
            .map(|r| r.client_id)
            .ok_or("No registered client")?;

        println!("[OAuth] Refreshing token...");

        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
        
        let params = [
            ("grant_type", "refresh_token"),
            ("client_id", &client_id),
            ("refresh_token", &refresh_token),
        ];

        let response = client
            .post(MCP_TOKEN_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Token refresh failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Token refresh returned {}: {}", status, body));
        }

        let mut new_token: OAuthToken = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse refresh token response: {}", e))?;

        // 발급 시점 기록
        new_token.issued_at = chrono::Utc::now().timestamp();

        // vault에 저장
        self.save_token(new_token).await?;

        println!("[OAuth] Token refreshed and saved");
        Ok(())
    }

    /// 로그아웃 (토큰 삭제)
    pub async fn logout(&self) {
        *self.token.lock().await = None;
        *self.pending_pkce.lock().await = None;
        
        // vault에서 토큰 삭제
        let _ = SECRETS.delete(VAULT_MCP_TOKEN).await;
        
        println!("[OAuth] Logged out, token deleted from vault");
    }

    /// 저장된 토큰 정보 조회 (자동 초기화 포함)
    /// 반환값: (토큰 존재 여부, 남은 유효 시간(초))
    pub async fn get_token_info(&self) -> (bool, Option<i64>) {
        let _ = self.initialize().await;
        
        let token = self.token.lock().await;
        match token.as_ref() {
            Some(t) => {
                let remaining = t.remaining_seconds();
                let is_valid = !t.is_expired();
                (is_valid, remaining)
            }
            None => (false, None),
        }
    }

    /// 완전 초기화 (토큰 + 클라이언트 모두 삭제)
    pub async fn clear_all(&self) {
        self.logout().await;
        *self.registered_client.lock().await = None;
        *self.initialized.lock().await = false;
        
        // vault에서 클라이언트도 삭제
        let _ = SECRETS.delete(VAULT_MCP_CLIENT).await;
        
        println!("[OAuth] All credentials cleared");
    }
}

impl Default for AtlassianOAuth {
    fn default() -> Self {
        Self::new()
    }
}
