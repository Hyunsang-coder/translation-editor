//! Secret Manager 모듈
//!
//! Master Key + Encrypted Vault 아키텍처를 통해 시크릿을 안전하게 관리합니다.
//!
//! - Keychain에는 마스터키 1개만 저장 (`ite:master_key_v1`)
//! - 나머지 시크릿은 `app_data_dir/secrets.vault` 파일에 AEAD로 암호화하여 저장
//! - 앱 런타임에서는 메모리 캐시로 보관하여 Keychain 추가 접근 없이 사용

pub mod manager;
pub mod vault;

pub use manager::{MigrationResult, SecretManager, SECRETS};

