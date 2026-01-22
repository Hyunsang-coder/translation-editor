use std::path::{Path, PathBuf};
use crate::error::{CommandError, CommandResult};

/// 시스템 중요 디렉토리 접근을 차단하는 Blocklist 검증 함수
/// - canonicalize()로 경로 정규화 후, 차단 목록과 비교합니다.
pub fn validate_path(path_str: &str) -> CommandResult<PathBuf> {
    let path = Path::new(path_str);

    // 1. 존재 여부 확인 및 Canonicalize
    // 파일이 존재하면 canonicalize 시도, 없으면 부모 디렉토리 검사
    let canonical_path = if path.exists() {
        path.canonicalize().map_err(|e| CommandError {
            code: "PATH_ERROR".to_string(),
            message: format!("Invalid path: {}", e),
            details: None,
        })?
    } else {
        if let Some(parent) = path.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize().map_err(|e| CommandError {
                    code: "PATH_ERROR".to_string(),
                    message: format!("Invalid parent path: {}", e),
                    details: None,
                })?;
                canonical_parent.join(path.file_name().unwrap_or_default())
            } else {
                return Err(CommandError {
                    code: "PATH_ERROR".to_string(),
                    message: "Parent directory does not exist".to_string(),
                    details: None,
                });
            }
        } else {
            // 부모 경로가 없는 경우 (루트 등)
            PathBuf::from(path_str)
        }
    };

    // 2. Blocklist Check (OS별 시스템 경로 차단)
    if is_blocked_path(&canonical_path) {
        return Err(CommandError {
            code: "SECURITY_ERROR".to_string(),
            message: "Access to system directory is blocked.".to_string(),
            details: None,
        });
    }

    Ok(canonical_path)
}

fn is_blocked_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    
    // Windows Blocklist
    #[cfg(target_os = "windows")]
    {
        let lower = path_str.to_lowercase();
        // C:\Windows, C:\Program Files 등
        if lower.contains(r"c:\windows") || 
           lower.contains(r"c:\program files") || 
           lower.contains(r"c:\program files (x86)") {
            return true;
        }
    }

    // Unix/Linux/macOS Blocklist
    #[cfg(not(target_os = "windows"))]
    {
        // 정확한 접두사 매칭을 위해 starts_with 사용
        // 단, /usr/local/bin 같은 사용자 툴 경로는 허용할 수도 있으나, 
        // 보수적으로 시스템 영역(/usr, /etc, /var) 전체를 막는 것이 안전함.
        // /Users (macOS) 또는 /home (Linux) 은 허용해야 함.
        if path_str.starts_with("/etc") || 
           path_str.starts_with("/var") || 
           path_str.starts_with("/root") || 
           path_str.starts_with("/proc") || 
           path_str.starts_with("/sys") ||
           path_str.starts_with("/bin") ||
           path_str.starts_with("/sbin") ||
           path_str.starts_with("/usr/bin") ||
           path_str.starts_with("/usr/sbin") {
            return true;
        }
    }

    false
}

