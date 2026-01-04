//! 커넥터 관련 Tauri 명령어
//!
//! OpenAI 빌트인 커넥터 (Google, Dropbox, Microsoft 등)의 OAuth 토큰을 관리합니다.
//! 토큰은 OS 키체인에 안전하게 저장됩니다.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "com.ite.app";
const CONNECTOR_TOKEN_PREFIX: &str = "connector:";

/// 커넥터 토큰 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub token_type: Option<String>,
}

/// 커넥터 상태 정보
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorStatus {
    pub connector_id: String,
    pub has_token: bool,
    pub expires_at: Option<i64>,
    pub is_expired: bool,
}

fn get_keychain_key(connector_id: &str) -> String {
    format!("{}{}", CONNECTOR_TOKEN_PREFIX, connector_id)
}

/// 커넥터 토큰 저장
#[tauri::command]
pub async fn connector_set_token(
    connector_id: String,
    token: ConnectorToken,
) -> Result<(), String> {
    let key = get_keychain_key(&connector_id);
    let token_json = serde_json::to_string(&token)
        .map_err(|e| format!("Failed to serialize token: {}", e))?;

    let entry = Entry::new(KEYCHAIN_SERVICE, &key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;

    entry
        .set_password(&token_json)
        .map_err(|e| format!("Failed to save token: {}", e))?;

    println!("[Connector] Token saved for {}", connector_id);
    Ok(())
}

/// 커넥터 토큰 조회 (액세스 토큰만 반환)
#[tauri::command]
pub async fn connector_get_token(connector_id: String) -> Result<Option<String>, String> {
    let key = get_keychain_key(&connector_id);

    let entry = match Entry::new(KEYCHAIN_SERVICE, &key) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };

    match entry.get_password() {
        Ok(token_json) => {
            let token: ConnectorToken = serde_json::from_str(&token_json)
                .map_err(|e| format!("Failed to parse token: {}", e))?;

            // 만료 확인
            if let Some(expires_at) = token.expires_at {
                let now = chrono::Utc::now().timestamp();
                if now >= expires_at {
                    println!("[Connector] Token expired for {}", connector_id);
                    // TODO: 자동 갱신 시도
                    return Ok(None);
                }
            }

            Ok(Some(token.access_token))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get token: {}", e)),
    }
}

/// 커넥터 토큰 삭제
#[tauri::command]
pub async fn connector_delete_token(connector_id: String) -> Result<(), String> {
    let key = get_keychain_key(&connector_id);

    let entry = match Entry::new(KEYCHAIN_SERVICE, &key) {
        Ok(e) => e,
        Err(_) => return Ok(()), // 엔트리가 없으면 성공
    };

    match entry.delete_password() {
        Ok(()) => {
            println!("[Connector] Token deleted for {}", connector_id);
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete token: {}", e)),
    }
}

/// 커넥터 상태 목록 조회
#[tauri::command]
pub async fn connector_list_status(connector_ids: Vec<String>) -> Result<Vec<ConnectorStatus>, String> {
    let now = chrono::Utc::now().timestamp();
    let mut statuses = Vec::new();

    for connector_id in connector_ids {
        let key = get_keychain_key(&connector_id);

        let (has_token, expires_at, is_expired) = match Entry::new(KEYCHAIN_SERVICE, &key) {
            Ok(entry) => match entry.get_password() {
                Ok(token_json) => {
                    if let Ok(token) = serde_json::from_str::<ConnectorToken>(&token_json) {
                        let expired = token.expires_at.map(|e| now >= e).unwrap_or(false);
                        (true, token.expires_at, expired)
                    } else {
                        (false, None, false)
                    }
                }
                Err(_) => (false, None, false),
            },
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

