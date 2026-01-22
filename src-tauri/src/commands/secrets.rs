//! Secret Manager Tauri 명령어
//!
//! SecretManager를 통해 시크릿을 안전하게 관리합니다.
//! - 모든 시크릿은 메모리 캐시 + 암호화된 vault 파일에 저장
//! - Keychain 접근은 마스터키 로드 시 1회만 발생

use crate::error::{CommandError, CommandResult};
use crate::secrets::{MigrationResult, SECRETS};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 시크릿 설정 요청
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretEntry {
    pub key: String,
    pub value: String,
}

/// 시크릿 초기화 결과
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretsInitResult {
    pub success: bool,
    pub cached_count: usize,
}

fn map_secret_error(err: crate::secrets::manager::SecretManagerError) -> CommandError {
    CommandError {
        code: "SECRET_MANAGER_ERROR".to_string(),
        message: format!("Secret manager error: {}", err),
        details: None,
    }
}

/// SecretManager 초기화
/// 
/// 앱 시작 시 호출하여 마스터키를 로드하고 vault를 복호화합니다.
/// 이 명령 호출 시 Keychain 프롬프트가 최대 1회 발생할 수 있습니다.
#[tauri::command]
pub async fn secrets_initialize() -> CommandResult<SecretsInitResult> {
    SECRETS
        .initialize()
        .await
        .map_err(map_secret_error)?;

    // 캐시된 시크릿 수 반환
    let count = SECRETS
        .list_keys_by_prefix("")
        .await
        .map_err(map_secret_error)?
        .len();

    Ok(SecretsInitResult {
        success: true,
        cached_count: count,
    })
}

/// 시크릿 조회
/// 
/// 여러 키를 한 번에 조회할 수 있습니다.
/// Keychain 프롬프트 없이 메모리 캐시에서 조회합니다.
#[tauri::command]
pub async fn secrets_get(keys: Vec<String>) -> CommandResult<HashMap<String, String>> {
    SECRETS
        .get_many(&keys)
        .await
        .map_err(map_secret_error)
}

/// 단일 시크릿 조회
#[tauri::command]
pub async fn secrets_get_one(key: String) -> CommandResult<Option<String>> {
    SECRETS
        .get(&key)
        .await
        .map_err(map_secret_error)
}

/// 시크릿 저장
/// 
/// 여러 키-값 쌍을 한 번에 저장할 수 있습니다.
/// 저장 후 vault 파일이 업데이트됩니다.
#[tauri::command]
pub async fn secrets_set(entries: Vec<SecretEntry>) -> CommandResult<()> {
    let entries: Vec<(String, String)> = entries
        .into_iter()
        .map(|e| (e.key, e.value))
        .collect();

    SECRETS
        .set_many(entries)
        .await
        .map_err(map_secret_error)
}

/// 단일 시크릿 저장
#[tauri::command]
pub async fn secrets_set_one(key: String, value: String) -> CommandResult<()> {
    SECRETS
        .set(&key, &value)
        .await
        .map_err(map_secret_error)
}

/// 시크릿 삭제
/// 
/// 여러 키를 한 번에 삭제할 수 있습니다.
#[tauri::command]
pub async fn secrets_delete(keys: Vec<String>) -> CommandResult<()> {
    SECRETS
        .delete_many(&keys)
        .await
        .map_err(map_secret_error)
}

/// 시크릿 존재 여부 확인
/// 
/// Keychain 프롬프트 없이 확인합니다.
#[tauri::command]
pub async fn secrets_has(key: String) -> CommandResult<bool> {
    SECRETS
        .has(&key)
        .await
        .map_err(map_secret_error)
}

/// 특정 prefix로 시작하는 모든 키 조회
#[tauri::command]
pub async fn secrets_list_keys(prefix: String) -> CommandResult<Vec<String>> {
    SECRETS
        .list_keys_by_prefix(&prefix)
        .await
        .map_err(map_secret_error)
}

/// 기존 Keychain 엔트리를 Vault로 마이그레이션
/// 
/// Settings에서 사용자가 명시적으로 호출합니다.
/// 마이그레이션 성공 시 기존 Keychain 엔트리는 삭제됩니다.
#[tauri::command]
pub async fn secrets_migrate_legacy() -> CommandResult<MigrationResult> {
    SECRETS
        .migrate_from_legacy_keychain()
        .await
        .map_err(map_secret_error)
}

