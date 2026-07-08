use crate::error::{CommandError, CommandResult};
use std::path::{Path, PathBuf};

/// 로그 미리보기용 UTF-8 안전 절단.
/// 바이트 인덱스 슬라이싱(`&s[..n]`)은 멀티바이트 문자 경계에서 패닉하므로,
/// `max_bytes` 이하의 가장 가까운 문자 경계까지만 자른다.
pub fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

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

/// 파일 크기 검증
pub fn validate_file_size(path: &std::path::Path, max_size: u64) -> CommandResult<u64> {
    let metadata = std::fs::metadata(path).map_err(|e| CommandError {
        code: "FILE_ERROR".to_string(),
        message: format!("파일 정보를 읽을 수 없습니다: {}", e),
        details: None,
    })?;

    let size = metadata.len();
    if size > max_size {
        return Err(CommandError {
            code: "FILE_TOO_LARGE".to_string(),
            message: format!(
                "파일 크기가 너무 큽니다: {}MB (최대 {}MB)",
                size / (1024 * 1024),
                max_size / (1024 * 1024)
            ),
            details: None,
        });
    }

    Ok(size)
}

fn is_macos_user_temp_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    // macOS std::env::temp_dir() → /var/folders/... (canonical: /private/var/folders/...)
    path_str.starts_with("/private/var/folders/")
        || path_str.starts_with("/var/folders/")
}

fn is_blocked_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();

    // Windows Blocklist
    #[cfg(target_os = "windows")]
    {
        let lower = path_str.to_lowercase();
        // C:\Windows, C:\Program Files 등
        if lower.contains(r"c:\windows")
            || lower.contains(r"c:\program files")
            || lower.contains(r"c:\program files (x86)")
        {
            return true;
        }
        // 시작 프로그램 폴더(로그인 시 자동 실행) 및 SSH 키 경로 차단 (지속성/자격증명 접근 방지)
        if lower.contains(r"\start menu\programs\startup")
            || lower.contains(r"\.ssh\")
            || lower.ends_with(r"\.ssh")
        {
            return true;
        }
    }

    // Unix/Linux/macOS Blocklist
    #[cfg(not(target_os = "windows"))]
    {
        // 사용자 임시 디렉토리(클립보드/드래그앤드롭 업로드)는 허용
        #[cfg(target_os = "macos")]
        if is_macos_user_temp_path(path) {
            return false;
        }

        // 정확한 접두사 매칭을 위해 starts_with 사용
        // 단, /usr/local/bin 같은 사용자 툴 경로는 허용할 수도 있으나,
        // 보수적으로 시스템 영역(/usr, /etc, /var) 전체를 막는 것이 안전함.
        // /Users (macOS) 또는 /home (Linux) 은 허용해야 함.
        if path_str.starts_with("/etc")
            || path_str.starts_with("/var")
            || path_str.starts_with("/private/etc")
            || path_str.starts_with("/private/var")
            || path_str.starts_with("/private/tmp")
            || path_str.starts_with("/root")
            || path_str.starts_with("/proc")
            || path_str.starts_with("/sys")
            || path_str.starts_with("/bin")
            || path_str.starts_with("/sbin")
            || path_str.starts_with("/usr/bin")
            || path_str.starts_with("/usr/sbin")
        {
            return true;
        }

        // 홈 디렉토리 내 민감 경로 차단 (SSH 키, 로그인 자동 실행 등록 등)
        // 홈 전체 allowlist 전환은 UX 영향이 커서 하지 않고, 지속성 공격 및
        // 자격증명 탈취 경로로 쓰이는 디렉토리만 추가로 차단한다.
        if let Ok(home) = std::env::var("HOME") {
            if !home.trim().is_empty() {
                // 검사 대상 path는 caller(validate_path)가 canonicalize한 값이므로,
                // home_path도 canonicalize해야 접두사 비교가 성립한다. $HOME 자체가
                // 심볼릭 링크(예: /Users 링크, 네트워크 홈)면 raw home_path는
                // canonical path의 접두사가 아니게 되어 .ssh/.aws 차단이 우회된다.
                let home_path = Path::new(&home)
                    .canonicalize()
                    .unwrap_or_else(|_| PathBuf::from(&home));
                let sensitive_rel: &[&str] = &[
                    ".ssh",
                    ".gnupg",
                    ".aws",
                    ".config/autostart",
                    // macOS 로그인 시 자동 실행 (지속성 공격 경로)
                    "Library/LaunchAgents",
                    "Library/LaunchDaemons",
                    "Library/Keychains",
                ];
                for rel in sensitive_rel {
                    if path.starts_with(home_path.join(rel)) {
                        return true;
                    }
                }
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_user_temp_path_is_allowed() {
        let path = Path::new("/private/var/folders/zz/abc/T/oddeyes-uploads/img.png");
        assert!(!is_blocked_path(path));
    }

    #[test]
    fn macos_system_var_path_is_blocked() {
        let path = Path::new("/private/var/db/system.db");
        assert!(is_blocked_path(path));
    }

    #[test]
    fn validate_path_allows_file_in_temp_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("clipboard-test.png");
        std::fs::write(&file, b"png").expect("write");

        let result = validate_path(&file.to_string_lossy());
        assert!(result.is_ok(), "expected ok, got {:?}", result);
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn home_sensitive_paths_are_blocked() {
        let home = std::env::var("HOME").expect("HOME should be set in tests");
        let ssh_key = Path::new(&home).join(".ssh/id_ed25519");
        assert!(is_blocked_path(&ssh_key));

        let launch_agent = Path::new(&home).join("Library/LaunchAgents/com.evil.persist.plist");
        assert!(is_blocked_path(&launch_agent));

        let autostart = Path::new(&home).join(".config/autostart/evil.desktop");
        assert!(is_blocked_path(&autostart));

        // 일반 문서 경로는 여전히 허용
        let doc = Path::new(&home).join("Documents/export.md");
        assert!(!is_blocked_path(&doc));

        // F5: $HOME 자체가 심볼릭 링크여도 canonical 경로가 차단돼야 한다.
        // 임시 디렉토리 안에 (real 홈 대역) + (그것을 가리키는 링크)를 만들고,
        // 링크를 통해 접근한 .ssh를 canonicalize한 경로로 검사한다.
        // is_blocked_path가 내부적으로 실제 $HOME을 읽으므로, 여기서는 fix의 핵심인
        // "canonicalize된 home_path가 링크 해소 경로의 접두사가 된다"만 직접 검증한다.
        {
            use std::os::unix::fs::symlink;
            let tmp = tempfile::tempdir().expect("tempdir");
            let real = tmp.path().join("real_home");
            std::fs::create_dir_all(real.join(".ssh")).expect("mkdir .ssh");
            let link = tmp.path().join("link_home");
            symlink(&real, &link).expect("symlink");

            // fix 후 home_path는 canonicalize되어 real_home이 됨.
            let home_canonical = link.canonicalize().expect("canonicalize link");
            // 링크 경유 .ssh를 canonicalize → real_home/.ssh
            let via_link = link.join(".ssh").canonicalize().expect("canonicalize .ssh");
            assert!(
                via_link.starts_with(home_canonical.join(".ssh")),
                "canonicalize된 home 접두사 매칭 실패: {:?} vs {:?}",
                via_link,
                home_canonical
            );
        }
    }

    #[test]
    fn truncate_utf8_respects_char_boundaries() {
        // "한"은 3바이트: 4바이트 절단 요청 시 경계(3)까지 후퇴
        let s = "한국어테스트";
        assert_eq!(truncate_utf8(s, 4), "한");
        assert_eq!(truncate_utf8(s, 6), "한국");
        // 길이 이하 요청은 원본 그대로
        assert_eq!(truncate_utf8(s, 1000), s);
        // ASCII는 그대로 절단
        assert_eq!(truncate_utf8("abcdef", 3), "abc");
        // 경계 0까지 후퇴하는 극단 케이스
        assert_eq!(truncate_utf8("한", 1), "");
    }
}
