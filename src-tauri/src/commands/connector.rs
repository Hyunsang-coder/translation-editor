//! 커넥터 관련 Tauri 명령어
//!
//! OpenAI 빌트인 커넥터 (Google, Dropbox, Microsoft 등)의 OAuth 토큰을 관리합니다.
//! 토큰은 SecretManager vault에 안전하게 저장됩니다.

use crate::secrets::SECRETS;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

/// 재사용 HTTP 클라이언트 (커넥션 풀링)
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

/// 토큰 갱신 single-flight 락.
/// 동시 요청이 같은(구) refresh_token으로 갱신을 중복 시도하면, rotation을 쓰는
/// provider에서 뒤늦은 쪽이 invalid_grant로 실패한다 (2026-07-07 리뷰 C2와 동일 패턴).
/// 락 획득 후 vault를 다시 읽어 만료 여부를 재확인(double-check)한다.
static CONNECTOR_REFRESH_LOCK: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));

/// 토큰 만료 전 갱신 여유 시간 (5분)
const TOKEN_REFRESH_MARGIN_SECS: i64 = 300;

/// 커넥터 토큰 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub token_type: Option<String>,
}

impl ConnectorToken {
    /// 토큰이 만료되었는지 (또는 곧 만료될지) 확인
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            let now = chrono::Utc::now().timestamp();
            // 만료 5분 전부터 갱신 필요
            now >= expires_at - TOKEN_REFRESH_MARGIN_SECS
        } else {
            false
        }
    }

    /// 갱신 가능 여부 (refresh_token 존재)
    pub fn can_refresh(&self) -> bool {
        self.refresh_token.is_some()
    }
}

/// 커넥터별 OAuth 설정
#[derive(Debug, Clone)]
struct OAuthConfig {
    token_url: &'static str,
    client_id_env: &'static str,
    client_secret_env: &'static str,
}

/// 지원되는 커넥터별 OAuth 설정
fn get_oauth_config(connector_id: &str) -> Option<OAuthConfig> {
    match connector_id {
        "googledrive" | "gmail" => Some(OAuthConfig {
            token_url: "https://oauth2.googleapis.com/token",
            client_id_env: "GOOGLE_CLIENT_ID",
            client_secret_env: "GOOGLE_CLIENT_SECRET",
        }),
        "dropbox" => Some(OAuthConfig {
            token_url: "https://api.dropboxapi.com/oauth2/token",
            client_id_env: "DROPBOX_CLIENT_ID",
            client_secret_env: "DROPBOX_CLIENT_SECRET",
        }),
        "onedrive" => Some(OAuthConfig {
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            client_id_env: "MICROSOFT_CLIENT_ID",
            client_secret_env: "MICROSOFT_CLIENT_SECRET",
        }),
        _ => None,
    }
}

/// 토큰 갱신 응답
#[derive(Debug, Deserialize)]
struct TokenRefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    token_type: Option<String>,
}

/// 토큰 갱신 시도
async fn try_refresh_token(
    connector_id: &str,
    current_token: &ConnectorToken,
) -> Result<ConnectorToken, String> {
    let refresh_token = current_token
        .refresh_token
        .as_ref()
        .ok_or("No refresh token available")?;

    let config = get_oauth_config(connector_id)
        .ok_or_else(|| format!("No OAuth config for connector: {}", connector_id))?;

    // 환경변수에서 클라이언트 자격증명 가져오기
    let client_id = std::env::var(config.client_id_env)
        .map_err(|_| format!("Missing env var: {}", config.client_id_env))?;
    let client_secret = std::env::var(config.client_secret_env)
        .map_err(|_| format!("Missing env var: {}", config.client_secret_env))?;

    debug!("[Connector] Attempting token refresh for {}", connector_id);

    let response = HTTP_CLIENT
        .post(config.token_url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Token refresh failed with status {}: {}",
            status, body
        ));
    }

    let refresh_response: TokenRefreshResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    // 새 토큰 생성 (expires_in을 expires_at으로 변환)
    let now = chrono::Utc::now().timestamp();
    let new_token = ConnectorToken {
        access_token: refresh_response.access_token,
        // 새 refresh_token이 있으면 사용, 없으면 기존 것 유지
        refresh_token: refresh_response
            .refresh_token
            .or_else(|| current_token.refresh_token.clone()),
        expires_at: refresh_response.expires_in.map(|exp| now + exp),
        token_type: refresh_response
            .token_type
            .or_else(|| current_token.token_type.clone()),
    };

    info!(
        "[Connector] Token refreshed successfully for {}",
        connector_id
    );
    Ok(new_token)
}

/// 커넥터 상태 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorStatus {
    pub connector_id: String,
    pub has_token: bool,
    pub expires_at: Option<i64>,
    pub is_expired: bool,
}

/// vault 키 생성
fn get_vault_key(connector_id: &str) -> String {
    format!("connector/{}/token_json", connector_id)
}

/// 커넥터 토큰 저장
#[tauri::command]
pub async fn connector_set_token(
    connector_id: String,
    token: ConnectorToken,
) -> Result<(), String> {
    let key = get_vault_key(&connector_id);
    let token_json =
        serde_json::to_string(&token).map_err(|e| format!("Failed to serialize token: {}", e))?;

    SECRETS
        .set(&key, &token_json)
        .await
        .map_err(|e| format!("Failed to save token: {}", e))?;

    info!("[Connector] Token saved for {}", connector_id);
    Ok(())
}

/// 커넥터 토큰 조회 (액세스 토큰만 반환)
///
/// 토큰이 만료되었거나 곧 만료될 경우 자동으로 갱신을 시도합니다.
#[tauri::command]
pub async fn connector_get_token(connector_id: String) -> Result<Option<String>, String> {
    let key = get_vault_key(&connector_id);

    let token: ConnectorToken = match SECRETS.get(&key).await {
        Ok(Some(token_json)) => serde_json::from_str(&token_json)
            .map_err(|e| format!("Failed to parse token: {}", e))?,
        Ok(None) => return Ok(None),
        Err(e) => return Err(format!("Failed to get token: {}", e)),
    };

    // 유효하면 그대로 반환
    if !token.is_expired() {
        return Ok(Some(token.access_token));
    }

    debug!(
        "[Connector] Token expired or expiring soon for {}",
        connector_id
    );

    if !token.can_refresh() {
        // refresh_token이 없으면 갱신 불가
        warn!(
            "[Connector] No refresh token available for {}",
            connector_id
        );
        return Ok(None);
    }

    // 갱신 single-flight: 동시 갱신이 같은(구) refresh_token을 재사용하지 않도록 직렬화
    let _refresh_guard = CONNECTOR_REFRESH_LOCK.lock().await;

    // double-check: 락 대기 중 다른 요청이 이미 갱신을 끝냈을 수 있으므로 vault를 다시 읽는다
    let token: ConnectorToken = match SECRETS.get(&key).await {
        Ok(Some(token_json)) => serde_json::from_str(&token_json)
            .map_err(|e| format!("Failed to parse token: {}", e))?,
        Ok(None) => return Ok(None),
        Err(e) => return Err(format!("Failed to get token: {}", e)),
    };
    if !token.is_expired() {
        return Ok(Some(token.access_token));
    }

    // 자동 갱신 시도
    match try_refresh_token(&connector_id, &token).await {
        Ok(new_token) => {
            // 갱신된 토큰을 vault에 저장
            let new_token_json = serde_json::to_string(&new_token)
                .map_err(|e| format!("Failed to serialize refreshed token: {}", e))?;
            SECRETS
                .set(&key, &new_token_json)
                .await
                .map_err(|e| format!("Failed to save refreshed token: {}", e))?;

            Ok(Some(new_token.access_token))
        }
        Err(e) => {
            warn!(
                "[Connector] Token refresh failed for {}: {}",
                connector_id, e
            );
            // 갱신 실패 시 만료된 토큰은 사용 불가 (저장된 토큰은 삭제하지 않음)
            Ok(None)
        }
    }
}

/// 커넥터 토큰 삭제
#[tauri::command]
pub async fn connector_delete_token(connector_id: String) -> Result<(), String> {
    let key = get_vault_key(&connector_id);

    SECRETS
        .delete(&key)
        .await
        .map_err(|e| format!("Failed to delete token: {}", e))?;

    info!("[Connector] Token deleted for {}", connector_id);
    Ok(())
}

/// 커넥터 상태 목록 조회
///
/// SecretManager 캐시에서 조회하므로 Keychain 프롬프트 없이 빠르게 조회됩니다.
#[tauri::command]
pub async fn connector_list_status(
    connector_ids: Vec<String>,
) -> Result<Vec<ConnectorStatus>, String> {
    let mut statuses = Vec::new();

    for connector_id in connector_ids {
        let key = get_vault_key(&connector_id);

        let (has_token, expires_at, is_expired) = match SECRETS.get(&key).await {
            Ok(Some(token_json)) => {
                if let Ok(token) = serde_json::from_str::<ConnectorToken>(&token_json) {
                    // is_expired()는 5분 여유를 두고 확인
                    (true, token.expires_at, token.is_expired())
                } else {
                    (false, None, false)
                }
            }
            Ok(None) => (false, None, false),
            Err(_) => (false, None, false),
        };

        statuses.push(ConnectorStatus {
            connector_id,
            has_token,
            expires_at,
            is_expired,
        });
    }

    Ok(statuses)
}

/// 커넥터 OAuth 플로우 시작 (TODO: Phase 2-oauth에서 구현)
#[tauri::command]
pub async fn connector_start_oauth(connector_id: String) -> Result<String, String> {
    // TODO: 각 서비스별 OAuth 플로우 구현
    // - Google: OAuth 2.0 with consent screen
    // - Dropbox: OAuth 2.0
    // - Microsoft: Azure AD OAuth 2.0
    Err(format!(
        "OAuth flow for {} is not yet implemented. Coming in Phase 2-oauth.",
        connector_id
    ))
}
