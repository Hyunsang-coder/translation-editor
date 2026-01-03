//! Atlassian MCP OAuth 2.1 PKCE 인증 구현
//! 
//! Atlassian MCP 서버는 자체 OAuth 엔드포인트를 제공합니다.
//! (auth.atlassian.com이 아닌 mcp.atlassian.com 사용)

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use url::Url;

// Atlassian MCP 서버 자체 OAuth 엔드포인트
// (https://mcp.atlassian.com/.well-known/oauth-authorization-server 에서 확인)
const MCP_AUTH_URL: &str = "https://mcp.atlassian.com/v1/authorize";
const MCP_TOKEN_URL: &str = "https://cf.mcp.atlassian.com/v1/token";
const MCP_REGISTRATION_URL: &str = "https://cf.mcp.atlassian.com/v1/register";
const REDIRECT_PORT: u16 = 23456;

/// OAuth 토큰
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: Option<i64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
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

/// 등록된 클라이언트 정보
#[derive(Debug, Clone)]
struct RegisteredClient {
    client_id: String,
    #[allow(dead_code)]
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
}

impl AtlassianOAuth {
    pub fn new() -> Self {
        Self {
            token: Arc::new(Mutex::new(None)),
            registered_client: Arc::new(Mutex::new(None)),
            pending_pkce: Arc::new(Mutex::new(None)),
            callback_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// 현재 토큰이 있는지 확인
    pub async fn has_token(&self) -> bool {
        self.token.lock().await.is_some()
    }

    /// 현재 액세스 토큰 가져오기
    pub async fn get_access_token(&self) -> Option<String> {
        self.token.lock().await.as_ref().map(|t| t.access_token.clone())
    }

    /// PKCE code_verifier 생성 (43-128자 랜덤 문자열)
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

    /// Dynamic Client Registration (RFC 7591)
    /// Atlassian MCP 서버에 동적으로 OAuth 클라이언트를 등록하고 client_id를 받습니다.
    async fn register_client(&self) -> Result<RegisteredClient, String> {
        // 이미 등록된 클라이언트가 있으면 재사용
        if let Some(client) = self.registered_client.lock().await.clone() {
            println!("[OAuth] Reusing existing client: {}", client.client_id);
            return Ok(client);
        }

        let redirect_uri = format!("http://localhost:{}/callback", REDIRECT_PORT);
        
        let registration_request = serde_json::json!({
            "client_name": "ITE - Integrated Translation Editor",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none"
        });

        println!("[OAuth] Registering OAuth client with Atlassian MCP server...");
        println!("[OAuth] Registration URL: {}", MCP_REGISTRATION_URL);
        
        let client = reqwest::Client::new();
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
            // 응답 내용 축약 (HTML이 길면)
            let body_preview = if body.len() > 200 { &body[..200] } else { &body };
            return Err(format!("Client registration failed with status {}: {}", status, body_preview));
        }

        let reg_response: ClientRegistrationResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse registration response: {}", e))?;

        println!("[OAuth] Client registered successfully: {}", reg_response.client_id);

        let registered = RegisteredClient {
            client_id: reg_response.client_id,
            client_secret: reg_response.client_secret,
        };

        *self.registered_client.lock().await = Some(registered.clone());
        Ok(registered)
    }

    /// OAuth 인증 URL 생성 및 브라우저 열기
    pub async fn start_auth_flow(&self) -> Result<String, String> {
        // 1. 먼저 Dynamic Client Registration 수행
        let registered_client = self.register_client().await?;

        let code_verifier = Self::generate_code_verifier();
        let code_challenge = Self::generate_code_challenge(&code_verifier);
        let state = Self::generate_state();

        // PKCE 데이터 저장
        *self.pending_pkce.lock().await = Some(PkceData {
            code_verifier: code_verifier.clone(),
            state: state.clone(),
        });

        // 인증 URL 구성 (MCP 서버 자체 authorize 엔드포인트 사용)
        let redirect_uri = format!("http://localhost:{}/callback", REDIRECT_PORT);
        let auth_url = format!(
            "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
            MCP_AUTH_URL,
            urlencoding::encode(&registered_client.client_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode("offline_access"),  // MCP 스코프
            state,
            code_challenge
        );

        println!("[OAuth] Authorization URL: {}", auth_url);

        // 로컬 콜백 서버 시작 및 브라우저 열기
        let (tx, rx) = oneshot::channel();
        *self.callback_tx.lock().await = Some(tx);

        // 콜백 서버 시작
        let callback_tx = self.callback_tx.clone();
        let pending_pkce = self.pending_pkce.clone();
        let token_storage = self.token.clone();
        let client_id = registered_client.client_id.clone();
        
        tokio::spawn(async move {
            if let Err(e) = Self::run_callback_server(REDIRECT_PORT, callback_tx, pending_pkce, token_storage, client_id).await {
                eprintln!("[OAuth] Callback server error: {}", e);
            }
        });

        // 잠시 대기 후 브라우저 열기 (서버가 시작될 때까지)
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // 브라우저에서 인증 URL 열기
        if let Err(e) = open::that(&auth_url) {
            return Err(format!("Failed to open browser: {}", e));
        }

        // 콜백 대기 (타임아웃: 5분)
        match tokio::time::timeout(tokio::time::Duration::from_secs(300), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("OAuth callback channel closed".to_string()),
            Err(_) => Err("OAuth timeout (5 minutes)".to_string()),
        }
    }

    /// 로컬 콜백 서버 실행
    async fn run_callback_server(
        port: u16,
        callback_tx: Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
        pending_pkce: Arc<Mutex<Option<PkceData>>>,
        token_storage: Arc<Mutex<Option<OAuthToken>>>,
        client_id: String,
    ) -> Result<(), String> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .map_err(|e| format!("Failed to bind callback server: {}", e))?;

        println!("[OAuth] Callback server listening on port {}", port);

        // 단일 연결만 처리
        let (mut stream, _) = listener.accept()
            .await
            .map_err(|e| format!("Failed to accept connection: {}", e))?;

        let mut reader = BufReader::new(&mut stream);
        let mut request_line = String::new();
        reader.read_line(&mut request_line)
            .await
            .map_err(|e| format!("Failed to read request: {}", e))?;

        // GET /callback?code=...&state=... 파싱
        let result = if let Some(path) = request_line.split_whitespace().nth(1) {
            if let Ok(url) = Url::parse(&format!("http://localhost{}", path)) {
                let params: HashMap<_, _> = url.query_pairs().collect();
                
                if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
                    // state 검증
                    let pkce_data = pending_pkce.lock().await.take();
                    if let Some(pkce) = pkce_data {
                        if &pkce.state == state.as_ref() {
                            // 토큰 교환 (MCP 토큰 엔드포인트 사용)
                            match Self::exchange_code_for_token(
                                code,
                                &pkce.code_verifier,
                                port,
                                &client_id,
                            ).await {
                                Ok(token) => {
                                    *token_storage.lock().await = Some(token);
                                    Ok("OAuth authentication successful".to_string())
                                }
                                Err(e) => Err(format!("Token exchange failed: {}", e))
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
            }
        } else {
            Err("Invalid HTTP request".to_string())
        };

        // HTML 응답 전송
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

        let _ = stream.write_all(response.as_bytes()).await;

        // 콜백 전송
        if let Some(tx) = callback_tx.lock().await.take() {
            let _ = tx.send(result);
        }

        Ok(())
    }

    /// Authorization code를 토큰으로 교환 (MCP 토큰 엔드포인트 사용)
    async fn exchange_code_for_token(
        code: &str,
        code_verifier: &str,
        port: u16,
        client_id: &str,
    ) -> Result<OAuthToken, String> {
        let redirect_uri = format!("http://localhost:{}/callback", port);
        
        println!("[OAuth] Exchanging code for token at: {}", MCP_TOKEN_URL);
        
        let client = reqwest::Client::new();
        let params = [
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", code_verifier),
        ];

        let response = client
            .post(MCP_TOKEN_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Token request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Token endpoint returned {}: {}", status, body));
        }

        response
            .json::<OAuthToken>()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))
    }

    /// 토큰 갱신 (refresh_token이 있는 경우)
    pub async fn refresh_token(&self) -> Result<(), String> {
        let current_token = self.token.lock().await.clone();
        let registered = self.registered_client.lock().await.clone();
        
        let refresh_token = current_token
            .and_then(|t| t.refresh_token)
            .ok_or("No refresh token available")?;

        let client_id = registered
            .map(|r| r.client_id)
            .ok_or("No registered client")?;

        let client = reqwest::Client::new();
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

        let new_token: OAuthToken = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse refresh token response: {}", e))?;

        *self.token.lock().await = Some(new_token);
        Ok(())
    }

    /// 로그아웃 (토큰 삭제)
    pub async fn logout(&self) {
        *self.token.lock().await = None;
        *self.pending_pkce.lock().await = None;
        // registered_client는 유지 (재사용 가능)
    }
}

impl Default for AtlassianOAuth {
    fn default() -> Self {
        Self::new()
    }
}
