//! Secure Store Commands
//!
//! OS 키체인/키링을 사용해 민감한 값을 안전하게 저장합니다.

use serde::Deserialize;
use keyring::{Entry, Error as KeyringError};

use crate::error::{CommandError, CommandResult};

const SERVICE_NAME: &str = "com.ite.app";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureSecretArgs {
    pub key: String,
    pub value: String,
}

fn map_keyring_error(err: KeyringError) -> CommandError {
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

#[tauri::command]
pub fn set_secure_secret(args: SecureSecretArgs) -> CommandResult<()> {
    validate_key(&args.key)?;
    let entry = Entry::new(SERVICE_NAME, &args.key).map_err(map_keyring_error)?;
    entry
        .set_password(&args.value)
        .map_err(map_keyring_error)?;
    Ok(())
}

#[tauri::command]
pub fn get_secure_secret(key: String) -> CommandResult<Option<String>> {
    validate_key(&key)?;
    let entry = Entry::new(SERVICE_NAME, &key).map_err(map_keyring_error)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(map_keyring_error(err)),
    }
}

#[tauri::command]
pub fn delete_secure_secret(key: String) -> CommandResult<()> {
    validate_key(&key)?;
    let entry = Entry::new(SERVICE_NAME, &key).map_err(map_keyring_error)?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(map_keyring_error(err)),
    }
}
