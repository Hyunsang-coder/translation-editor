//! Secure Store Commands
//!
//! SecretManager를 통해 민감한 값을 안전하게 저장합니다.
//! (기존 keyring 직접 사용에서 SecretManager로 마이그레이션됨)

use serde::Deserialize;

use crate::error::{CommandError, CommandResult};
use crate::secrets::SECRETS;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureSecretArgs {
    pub key: String,
    pub value: String,
}

fn map_secret_error(err: crate::secrets::manager::SecretManagerError) -> CommandError {
    CommandError {
        code: "SECURE_STORE_ERROR".to_string(),
        message: format!("Secure store error: {}", err),
        details: None,
    }
}

fn validate_key(key: &str) -> Result<(), CommandError> {
    if key.trim().is_empty() {
        return Err(CommandError {
            code: "INVALID_KEY".to_string(),
            message: "Secure store key must not be empty.".to_string(),
            details: None,
        });
    }
    Ok(())
}

/// 키를 vault namespace로 변환
/// 예: "ai:api_keys_bundle" -> "ai/api_keys_bundle"
fn to_vault_key(key: &str) -> String {
    key.replace(':', "/")
}

#[tauri::command]
pub async fn set_secure_secret(args: SecureSecretArgs) -> CommandResult<()> {
    validate_key(&args.key)?;
    let vault_key = to_vault_key(&args.key);
    SECRETS
        .set(&vault_key, &args.value)
        .await
        .map_err(map_secret_error)?;
    Ok(())
}

#[tauri::command]
pub async fn get_secure_secret(key: String) -> CommandResult<Option<String>> {
    validate_key(&key)?;
    let vault_key = to_vault_key(&key);
    SECRETS
        .get(&vault_key)
        .await
        .map_err(map_secret_error)
}

#[tauri::command]
pub async fn delete_secure_secret(key: String) -> CommandResult<()> {
    validate_key(&key)?;
    let vault_key = to_vault_key(&key);
    SECRETS
        .delete(&vault_key)
        .await
        .map_err(map_secret_error)?;
    Ok(())
}
