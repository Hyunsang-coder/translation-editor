//! Secret Manager - 마스터키 관리 및 시크릿 캐시
//!
//! - 마스터키는 Keychain에서 1회 로드 (`ite:master_key_v1`)
//! - 시크릿은 메모리 캐시로 보관
//! - 변경 시 vault 파일 업데이트

use crate::secrets::vault::{
    encrypt_and_write, get_vault_path, read_and_decrypt, vault_exists, SecretsPayload,
    MASTER_KEY_LEN,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use keyring::Entry;
use once_cell::sync::Lazy;
use rand::Rng;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use zeroize::Zeroize;

/// Keychain 서비스 이름
const KEYCHAIN_SERVICE: &str = "com.ite.app";
/// 마스터키 Keychain 키
const MASTER_KEY_KEYCHAIN_KEY: &str = "ite:master_key_v1";

/// 전역 SecretManager 인스턴스
pub static SECRETS: Lazy<SecretManager> = Lazy::new(SecretManager::new);

/// Secret Manager 오류
#[derive(Debug, thiserror::Error)]
pub enum SecretManagerError {
    #[error("Keychain error: {0}")]
    Keychain(String),

    #[error("Keychain entry not found")]
    KeychainNoEntry,

    #[error("Vault error: {0}")]
    Vault(#[from] crate::secrets::vault::VaultError),

    #[error("Not initialized")]
    NotInitialized,

    #[error("Invalid master key format")]
    InvalidMasterKey,

    #[error("App data dir not set")]
    AppDataDirNotSet,
}

/// 초기화 상태
#[derive(Debug, Clone, PartialEq)]
pub enum InitState {
    NotInitialized,
    Initializing,
    Ready,
    Failed(String),
}

/// Secret Manager
///
/// 앱 시작 시 initialize()를 호출하면:
/// 1. Keychain에서 마스터키를 로드 (없으면 생성)
/// 2. vault 파일이 있으면 복호화하여 캐시에 로드
pub struct SecretManager {
    /// 마스터키 (메모리에 캐시, drop 시 zeroize)
    master_key: Arc<RwLock<Option<MasterKey>>>,
    /// 시크릿 캐시
    cache: Arc<RwLock<HashMap<String, String>>>,
    /// 초기화 상태
    state: Arc<RwLock<InitState>>,
    /// app_data_dir 경로
    app_data_dir: Arc<RwLock<Option<PathBuf>>>,
}

/// Zeroize가 적용된 마스터키 래퍼
#[derive(Clone)]
struct MasterKey {
    bytes: [u8; MASTER_KEY_LEN],
}

impl Drop for MasterKey {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

impl SecretManager {
    pub fn new() -> Self {
        Self {
            master_key: Arc::new(RwLock::new(None)),
            cache: Arc::new(RwLock::new(HashMap::new())),
            state: Arc::new(RwLock::new(InitState::NotInitialized)),
            app_data_dir: Arc::new(RwLock::new(None)),
        }
    }

    /// app_data_dir 설정 (lib.rs의 setup에서 호출)
    pub async fn set_app_data_dir(&self, path: PathBuf) {
        *self.app_data_dir.write().await = Some(path);
    }

    /// 초기화 (앱 시작 시 1회 호출)
    ///
    /// 1. Keychain에서 마스터키 로드 (없으면 생성하고 저장)
    /// 2. vault 파일이 있으면 복호화하여 캐시에 로드
    pub async fn initialize(&self) -> Result<(), SecretManagerError> {
        // 이미 초기화되었는지 확인
        {
            let state = self.state.read().await;
            match &*state {
                InitState::Ready => return Ok(()),
                InitState::Initializing => return Ok(()), // 다른 곳에서 초기화 중
                InitState::Failed(msg) => {
                    return Err(SecretManagerError::Vault(
                        crate::secrets::vault::VaultError::InvalidFormat(msg.clone()),
                    ))
                }
                InitState::NotInitialized => {}
            }
        }

        *self.state.write().await = InitState::Initializing;

        println!("[SecretManager] Initializing...");

        // 1. 마스터키 로드 또는 생성
        let master_key = match self.load_master_key_from_keychain() {
            Ok(key) => {
                println!("[SecretManager] Master key loaded from keychain");
                key
            }
            Err(SecretManagerError::KeychainNoEntry) => {
                // 마스터키가 없으면 새로 생성
                println!("[SecretManager] No master key found, generating new one...");
                let new_key = Self::generate_master_key();
                self.save_master_key_to_keychain(&new_key)?;
                println!("[SecretManager] New master key saved to keychain");
                new_key
            }
            Err(e) => {
                *self.state.write().await = InitState::Failed(e.to_string());
                return Err(e);
            }
        };

        *self.master_key.write().await = Some(MasterKey {
            bytes: master_key,
        });

        // 2. Vault 파일 로드 (있으면)
        let app_data_dir = self.app_data_dir.read().await.clone();
        if let Some(dir) = app_data_dir {
            let vault_path = get_vault_path(&dir);
            if vault_exists(&vault_path) {
                match read_and_decrypt(&vault_path, &master_key) {
                    Ok(payload) => {
                        *self.cache.write().await = payload.secrets;
                        println!(
                            "[SecretManager] Vault loaded, {} secrets cached",
                            self.cache.read().await.len()
                        );
                    }
                    Err(e) => {
                        println!("[SecretManager] Failed to load vault: {}", e);
                        // Vault 로드 실패는 치명적이지 않음 (새 vault로 시작)
                    }
                }
            } else {
                println!("[SecretManager] No existing vault, starting fresh");
            }
        } else {
            println!("[SecretManager] Warning: app_data_dir not set yet");
        }

        *self.state.write().await = InitState::Ready;
        println!("[SecretManager] Initialization complete");

        Ok(())
    }

    /// 초기화 상태 확인
    pub async fn is_initialized(&self) -> bool {
        *self.state.read().await == InitState::Ready
    }

    /// 필요 시 자동 초기화 (lazy init)
    async fn ensure_initialized(&self) -> Result<(), SecretManagerError> {
        if !self.is_initialized().await {
            self.initialize().await?;
        }
        Ok(())
    }

    /// 시크릿 가져오기
    pub async fn get(&self, key: &str) -> Result<Option<String>, SecretManagerError> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache.get(key).cloned())
    }

    /// 여러 시크릿 가져오기
    pub async fn get_many(
        &self,
        keys: &[String],
    ) -> Result<HashMap<String, String>, SecretManagerError> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        let mut result = HashMap::new();
        for key in keys {
            if let Some(value) = cache.get(key) {
                result.insert(key.clone(), value.clone());
            }
        }
        Ok(result)
    }

    /// 시크릿 저장
    pub async fn set(&self, key: &str, value: &str) -> Result<(), SecretManagerError> {
        self.ensure_initialized().await?;

        // 캐시 업데이트
        {
            let mut cache = self.cache.write().await;
            cache.insert(key.to_string(), value.to_string());
        }

        // Vault 파일 저장
        self.persist_vault().await?;

        println!("[SecretManager] Secret set: {}", key);
        Ok(())
    }

    /// 여러 시크릿 저장
    pub async fn set_many(
        &self,
        entries: Vec<(String, String)>,
    ) -> Result<(), SecretManagerError> {
        self.ensure_initialized().await?;

        // 캐시 업데이트
        {
            let mut cache = self.cache.write().await;
            for (key, value) in &entries {
                cache.insert(key.clone(), value.clone());
            }
        }

        // Vault 파일 저장
        self.persist_vault().await?;

        println!("[SecretManager] {} secrets set", entries.len());
        Ok(())
    }

    /// 시크릿 삭제
    pub async fn delete(&self, key: &str) -> Result<(), SecretManagerError> {
        self.ensure_initialized().await?;

        // 캐시에서 삭제
        {
            let mut cache = self.cache.write().await;
            cache.remove(key);
        }

        // Vault 파일 저장
        self.persist_vault().await?;

        println!("[SecretManager] Secret deleted: {}", key);
        Ok(())
    }

    /// 여러 시크릿 삭제
    pub async fn delete_many(&self, keys: &[String]) -> Result<(), SecretManagerError> {
        self.ensure_initialized().await?;

        // 캐시에서 삭제
        {
            let mut cache = self.cache.write().await;
            for key in keys {
                cache.remove(key);
            }
        }

        // Vault 파일 저장
        self.persist_vault().await?;

        println!("[SecretManager] {} secrets deleted", keys.len());
        Ok(())
    }

    /// 특정 prefix로 시작하는 모든 키 조회
    pub async fn list_keys_by_prefix(&self, prefix: &str) -> Result<Vec<String>, SecretManagerError> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect())
    }

    /// 시크릿 존재 여부 확인 (Keychain 프롬프트 없이)
    pub async fn has(&self, key: &str) -> Result<bool, SecretManagerError> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache.contains_key(key))
    }

    /// Vault 파일에 현재 캐시 저장
    async fn persist_vault(&self) -> Result<(), SecretManagerError> {
        let master_key = self.master_key.read().await;
        let master_key = master_key
            .as_ref()
            .ok_or(SecretManagerError::NotInitialized)?;

        let app_data_dir = self.app_data_dir.read().await;
        let app_data_dir = app_data_dir
            .as_ref()
            .ok_or(SecretManagerError::AppDataDirNotSet)?;

        let vault_path = get_vault_path(app_data_dir);

        // 디렉토리 생성
        if let Some(parent) = vault_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let cache = self.cache.read().await;
        let payload = SecretsPayload {
            secrets: cache.clone(),
            version: 1,
        };

        encrypt_and_write(&vault_path, &master_key.bytes, &payload)?;

        Ok(())
    }

    /// 마스터키 생성 (CSPRNG)
    fn generate_master_key() -> [u8; MASTER_KEY_LEN] {
        let mut key = [0u8; MASTER_KEY_LEN];
        rand::thread_rng().fill(&mut key);
        key
    }

    /// Keychain에서 마스터키 로드
    fn load_master_key_from_keychain(&self) -> Result<[u8; MASTER_KEY_LEN], SecretManagerError> {
        let entry = Entry::new(KEYCHAIN_SERVICE, MASTER_KEY_KEYCHAIN_KEY)
            .map_err(|e| SecretManagerError::Keychain(e.to_string()))?;

        let password = match entry.get_password() {
            Ok(password) => password,
            Err(keyring::Error::NoEntry) => return Err(SecretManagerError::KeychainNoEntry),
            Err(e) => return Err(SecretManagerError::Keychain(e.to_string())),
        };

        // Base64 디코딩
        let bytes = BASE64
            .decode(&password)
            .map_err(|_| SecretManagerError::InvalidMasterKey)?;

        if bytes.len() != MASTER_KEY_LEN {
            return Err(SecretManagerError::InvalidMasterKey);
        }

        let mut key = [0u8; MASTER_KEY_LEN];
        key.copy_from_slice(&bytes);

        Ok(key)
    }

    /// Keychain에 마스터키 저장
    fn save_master_key_to_keychain(
        &self,
        key: &[u8; MASTER_KEY_LEN],
    ) -> Result<(), SecretManagerError> {
        let entry = Entry::new(KEYCHAIN_SERVICE, MASTER_KEY_KEYCHAIN_KEY)
            .map_err(|e| SecretManagerError::Keychain(e.to_string()))?;

        // Base64 인코딩
        let encoded = BASE64.encode(key);

        entry
            .set_password(&encoded)
            .map_err(|e| SecretManagerError::Keychain(e.to_string()))?;

        Ok(())
    }

    // =====================================
    // 마이그레이션 지원 (기존 Keychain → Vault)
    // =====================================

    /// 기존 Keychain 엔트리에서 값 읽기 (마이그레이션용)
    pub fn read_legacy_keychain(key: &str) -> Option<String> {
        let entry = Entry::new(KEYCHAIN_SERVICE, key).ok()?;
        match entry.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                eprintln!("[SecretManager] Legacy keychain read error for {}: {}", key, e);
                None
            }
        }
    }

    /// 기존 Keychain 엔트리 삭제 (마이그레이션 후)
    pub fn delete_legacy_keychain(key: &str) {
        if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, key) {
            let _ = entry.delete_password();
        }
    }

    /// 기존 Keychain 엔트리들을 Vault로 마이그레이션
    /// 
    /// 알려진 키 목록:
    /// - `ai:api_keys_bundle` → `ai/api_keys_bundle`
    /// - `mcp:oauth_token` → `mcp/atlassian/oauth_token_json`
    /// - `mcp:client_id` → `mcp/atlassian/client_json`
    /// - `notion:integration_token` → `notion/integration_token`
    /// - `mcp:notion_config` → `mcp/notion/config_json`
    /// - `connector:*` → `connector/*/token_json`
    pub async fn migrate_from_legacy_keychain(&self) -> Result<MigrationResult, SecretManagerError> {
        self.ensure_initialized().await?;

        let mut migrated = 0;
        let mut failed = 0;
        let mut details = Vec::new();

        // 알려진 레거시 키 매핑
        let mappings = vec![
            ("ai:api_keys_bundle", "ai/api_keys_bundle"),
            ("mcp:oauth_token", "mcp/atlassian/oauth_token_json"),
            ("mcp:client_id", "mcp/atlassian/client_json"),
            ("notion:integration_token", "notion/integration_token"),
            ("mcp:notion_config", "mcp/notion/config_json"),
        ];

        for (old_key, new_key) in mappings {
            if let Some(value) = Self::read_legacy_keychain(old_key) {
                match self.set(new_key, &value).await {
                    Ok(_) => {
                        Self::delete_legacy_keychain(old_key);
                        details.push(format!("✓ {} → {}", old_key, new_key));
                        migrated += 1;
                    }
                    Err(e) => {
                        details.push(format!("✗ {} failed: {}", old_key, e));
                        failed += 1;
                    }
                }
            }
        }

        // 커넥터 토큰 마이그레이션 (알려진 커넥터 ID 목록)
        // OpenAI 빌트인 커넥터 및 가능한 커넥터 ID들
        let known_connector_ids = vec![
            "googledrive",
            "gmail",
            "dropbox",
            "onedrive",
            "sharepoint",
            "slack",
            "github",
            "atlassian",
            "notion",
        ];

        for connector_id in known_connector_ids {
            let old_key = format!("connector:{}", connector_id);
            let new_key = format!("connector/{}/token_json", connector_id);
            
            if let Some(value) = Self::read_legacy_keychain(&old_key) {
                match self.set(&new_key, &value).await {
                    Ok(_) => {
                        Self::delete_legacy_keychain(&old_key);
                        details.push(format!("✓ {} → {}", old_key, new_key));
                        migrated += 1;
                    }
                    Err(e) => {
                        details.push(format!("✗ {} failed: {}", old_key, e));
                        failed += 1;
                    }
                }
            }
        }

        Ok(MigrationResult {
            migrated,
            failed,
            details,
        })
    }
}

impl Default for SecretManager {
    fn default() -> Self {
        Self::new()
    }
}

/// 마이그레이션 결과
#[derive(Debug, Clone, serde::Serialize)]
pub struct MigrationResult {
    pub migrated: usize,
    pub failed: usize,
    pub details: Vec<String>,
}

// vault::VaultError를 std::io::Error로 변환
impl From<std::io::Error> for SecretManagerError {
    fn from(err: std::io::Error) -> Self {
        SecretManagerError::Vault(crate::secrets::vault::VaultError::Io(err))
    }
}
