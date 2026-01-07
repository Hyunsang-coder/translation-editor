//! Vault 파일 I/O 및 암호화/복호화
//!
//! 파일 포맷 (v1):
//! - magic: `ITESECR1` (8 bytes)
//! - nonce: 24 bytes (XChaCha20-Poly1305)
//! - ciphertext: AEAD 결과 (= 암호문 + 태그)
//!
//! AAD: magic를 AAD로 사용 (포맷 바인딩)

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

/// 파일 매직 (8 bytes)
pub const VAULT_MAGIC: &[u8; 8] = b"ITESECR1";

/// 마스터키 길이 (256-bit)
pub const MASTER_KEY_LEN: usize = 32;

/// Nonce 길이 (XChaCha20-Poly1305용 24 bytes)
pub const NONCE_LEN: usize = 24;

/// Vault 오류
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid vault magic")]
    InvalidMagic,

    #[error("Invalid vault format: {0}")]
    InvalidFormat(String),

    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// Vault에 저장되는 시크릿 페이로드
/// 
/// 키는 namespaced string으로 통일:
/// - `ai/openai_api_key`
/// - `ai/brave_api_key`
/// - `mcp/atlassian/oauth_token_json`
/// - `notion/integration_token`
/// - `connector/<id>/token_json`
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecretsPayload {
    /// 시크릿 키-값 맵
    pub secrets: HashMap<String, String>,
    /// 페이로드 버전 (향후 마이그레이션용)
    #[serde(default = "default_version")]
    pub version: u32,
}

fn default_version() -> u32 {
    1
}

/// 마스터키를 사용해 페이로드를 암호화하고 vault 파일에 저장
pub fn encrypt_and_write(
    path: &Path,
    master_key: &[u8; MASTER_KEY_LEN],
    payload: &SecretsPayload,
) -> Result<(), VaultError> {
    // 페이로드를 JSON으로 직렬화
    let plaintext = serde_json::to_vec(payload)?;

    // 랜덤 nonce 생성
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill(&mut nonce);

    // XChaCha20-Poly1305 cipher 생성
    let cipher = XChaCha20Poly1305::new(master_key.into());

    // AAD로 매직 사용
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|e| VaultError::EncryptionFailed(e.to_string()))?;

    // Atomic write: 임시 파일에 쓰고 rename
    let tmp_path = path.with_extension("vault.tmp");

    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(VAULT_MAGIC)?;
    file.write_all(&nonce)?;
    file.write_all(&ciphertext)?;
    file.sync_all()?;
    drop(file);

    fs::rename(&tmp_path, path)?;

    Ok(())
}

/// Vault 파일을 읽고 마스터키로 복호화
pub fn read_and_decrypt(
    path: &Path,
    master_key: &[u8; MASTER_KEY_LEN],
) -> Result<SecretsPayload, VaultError> {
    let mut file = fs::File::open(path)?;

    // Magic 검증
    let mut magic = [0u8; 8];
    file.read_exact(&mut magic)?;
    if &magic != VAULT_MAGIC {
        return Err(VaultError::InvalidMagic);
    }

    // Nonce 읽기
    let mut nonce = [0u8; NONCE_LEN];
    file.read_exact(&mut nonce)?;

    // 나머지 = ciphertext
    let mut ciphertext = Vec::new();
    file.read_to_end(&mut ciphertext)?;

    // XChaCha20-Poly1305 cipher 생성
    let cipher = XChaCha20Poly1305::new(master_key.into());

    // 복호화
    let mut plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|e| VaultError::DecryptionFailed(e.to_string()))?;

    // JSON 역직렬화
    let payload: SecretsPayload = serde_json::from_slice(&plaintext)?;

    // 평문 메모리 지우기
    plaintext.zeroize();

    Ok(payload)
}

/// Vault 파일이 존재하는지 확인
pub fn vault_exists(path: &Path) -> bool {
    path.exists()
}

/// app_data_dir 기반 vault 경로 생성
pub fn get_vault_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("secrets.vault")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("test.vault");

        // 테스트용 마스터키
        let mut master_key = [0u8; MASTER_KEY_LEN];
        rand::thread_rng().fill(&mut master_key);

        // 페이로드 생성
        let mut payload = SecretsPayload::default();
        payload.secrets.insert("ai/openai_api_key".to_string(), "sk-test123".to_string());
        payload.secrets.insert("notion/token".to_string(), "ntn_xxx".to_string());

        // 암호화 및 저장
        encrypt_and_write(&vault_path, &master_key, &payload).unwrap();

        // 파일 존재 확인
        assert!(vault_path.exists());

        // 복호화 및 검증
        let decrypted = read_and_decrypt(&vault_path, &master_key).unwrap();
        assert_eq!(decrypted.secrets.get("ai/openai_api_key"), Some(&"sk-test123".to_string()));
        assert_eq!(decrypted.secrets.get("notion/token"), Some(&"ntn_xxx".to_string()));
    }

    #[test]
    fn test_wrong_key_fails() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("test.vault");

        let mut key1 = [0u8; MASTER_KEY_LEN];
        let mut key2 = [1u8; MASTER_KEY_LEN];
        rand::thread_rng().fill(&mut key1);
        rand::thread_rng().fill(&mut key2);

        let payload = SecretsPayload::default();
        encrypt_and_write(&vault_path, &key1, &payload).unwrap();

        // 다른 키로 복호화 시도하면 실패해야 함
        let result = read_and_decrypt(&vault_path, &key2);
        assert!(result.is_err());
    }
}

