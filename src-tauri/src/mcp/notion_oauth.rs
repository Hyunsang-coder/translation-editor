//! Notion MCP 설정 관리
//!
//! 로컬 Notion MCP 서버 연결 설정을 OS 키체인에 저장/로드합니다.
//!
//! 설정 항목:
//! - MCP 서버 URL (기본값: http://localhost:3000/mcp)
//! - Auth Token (서버 접근용, 서버 실행 시 생성됨)
//!
//! 사용 방법:
//! 1. 사용자가 터미널에서 `NOTION_TOKEN=ntn_xxx npx @notionhq/notion-mcp-server --transport http` 실행
//! 2. 서버가 출력한 Auth Token을 앱 설정에 입력
//! 3. 앱이 로컬 서버에 연결

use keyring::Entry;
use std::sync::Arc;
use tokio::sync::Mutex;

// 키체인 저장 키
const KEYCHAIN_SERVICE: &str = "com.ite.app";
const KEYCHAIN_NOTION_CONFIG: &str = "mcp:notion_config";

// 기본 MCP 서버 URL
const DEFAULT_MCP_URL: &str = "http://localhost:3000/mcp";

/// Notion MCP 설정 (영속화 가능)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NotionMcpConfig {
    /// MCP 서버 URL (기본값: http://localhost:3000/mcp)
    pub mcp_url: String,
    /// MCP 서버 Auth Token (서버 접근용)
    pub auth_token: String,
    /// 설정 저장 시점 (Unix timestamp, 초)
    #[serde(default)]
    pub saved_at: i64,
}

impl Default for NotionMcpConfig {
    fn default() -> Self {
        Self {
            mcp_url: DEFAULT_MCP_URL.to_string(),
            auth_token: String::new(),
            saved_at: 0,
        }
    }
}

impl NotionMcpConfig {
    /// 설정이 유효한지 확인 (Auth Token이 있는지)
    pub fn is_valid(&self) -> bool {
        !self.auth_token.is_empty()
    }
}

/// Notion MCP 설정 관리 핸들러
pub struct NotionOAuth {
    /// 현재 설정
    config: Arc<Mutex<Option<NotionMcpConfig>>>,
    /// 초기화 완료 여부
    initialized: Arc<Mutex<bool>>,
}

impl NotionOAuth {
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(None)),
            initialized: Arc::new(Mutex::new(false)),
        }
    }

    /// 키체인에서 저장된 설정 로드 (앱 시작 시 호출)
    pub async fn initialize(&self) -> Result<(), String> {
        let mut initialized = self.initialized.lock().await;
        if *initialized {
            return Ok(());
        }

        println!("[NotionMCP] Initializing config from keychain...");

        // 저장된 설정 로드
        if let Some(config_json) = Self::load_from_keychain(KEYCHAIN_NOTION_CONFIG) {
            if let Ok(config) = serde_json::from_str::<NotionMcpConfig>(&config_json) {
                println!(
                    "[NotionMCP] Loaded config from keychain (URL: {}, has_token: {})",
                    config.mcp_url,
                    !config.auth_token.is_empty()
                );
                *self.config.lock().await = Some(config);
            }
        }

        *initialized = true;
        Ok(())
    }

    /// 키체인에서 값 로드
    fn load_from_keychain(key: &str) -> Option<String> {
        match Entry::new(KEYCHAIN_SERVICE, key) {
            Ok(entry) => match entry.get_password() {
                Ok(value) => Some(value),
                Err(keyring::Error::NoEntry) => None,
                Err(e) => {
                    eprintln!("[NotionMCP] Keychain read error for {}: {}", key, e);
                    None
                }
            },
            Err(e) => {
                eprintln!("[NotionMCP] Keychain entry error for {}: {}", key, e);
                None
            }
        }
    }

    /// 키체인에 값 저장
    fn save_to_keychain(key: &str, value: &str) -> Result<(), String> {
        let entry = Entry::new(KEYCHAIN_SERVICE, key)
            .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
        entry
            .set_password(value)
            .map_err(|e| format!("Failed to save to keychain: {}", e))
    }

    /// 키체인에서 값 삭제
    fn delete_from_keychain(key: &str) {
        if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, key) {
            let _ = entry.delete_password();
        }
    }

    /// 설정 저장 (메모리 + 키체인)
    pub async fn save_config(&self, config: NotionMcpConfig) -> Result<(), String> {
        let config_json = serde_json::to_string(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        Self::save_to_keychain(KEYCHAIN_NOTION_CONFIG, &config_json)?;
        *self.config.lock().await = Some(config);

        println!("[NotionMCP] Config saved to keychain");
        Ok(())
    }

    /// MCP 설정 저장 (사용자 입력)
    pub async fn set_config(
        &self,
        mcp_url: Option<String>,
        auth_token: String,
    ) -> Result<(), String> {
        // Auth Token 검증 (비어있으면 안 됨)
        if auth_token.is_empty() {
            return Err("Auth token is required".to_string());
        }

        let config = NotionMcpConfig {
            mcp_url: mcp_url.unwrap_or_else(|| DEFAULT_MCP_URL.to_string()),
            auth_token,
            saved_at: chrono::Utc::now().timestamp(),
        };

        self.save_config(config).await?;

        Ok(())
    }

    /// 현재 설정이 있는지 확인 (자동 초기화 포함)
    pub async fn has_config(&self) -> bool {
        let _ = self.initialize().await;
        let config = self.config.lock().await;
        config.as_ref().map(|c| c.is_valid()).unwrap_or(false)
    }

    /// MCP 서버 URL 가져오기
    pub async fn get_mcp_url(&self) -> String {
        let _ = self.initialize().await;
        self.config
            .lock()
            .await
            .as_ref()
            .map(|c| c.mcp_url.clone())
            .unwrap_or_else(|| DEFAULT_MCP_URL.to_string())
    }

    /// Auth Token 가져오기
    pub async fn get_access_token(&self) -> Option<String> {
        let _ = self.initialize().await;
        self.config
            .lock()
            .await
            .as_ref()
            .filter(|c| c.is_valid())
            .map(|c| c.auth_token.clone())
    }

    /// 저장된 설정 정보 조회 (자동 초기화 포함)
    /// 반환값: (설정 존재 여부, 저장 시점 timestamp)
    pub async fn get_token_info(&self) -> (bool, Option<i64>) {
        let _ = self.initialize().await;

        let config = self.config.lock().await;
        match config.as_ref() {
            Some(c) if c.is_valid() => (true, Some(c.saved_at)),
            _ => (false, None),
        }
    }

    /// 로그아웃 (설정 삭제)
    pub async fn logout(&self) {
        *self.config.lock().await = None;

        // 키체인에서 설정 삭제
        Self::delete_from_keychain(KEYCHAIN_NOTION_CONFIG);

        println!("[NotionMCP] Logged out, config deleted from keychain");
    }

    /// 완전 초기화 (설정 삭제)
    pub async fn clear_all(&self) {
        self.logout().await;
        *self.initialized.lock().await = false;

        println!("[NotionMCP] All config cleared");
    }
}

impl Default for NotionOAuth {
    fn default() -> Self {
        Self::new()
    }
}
