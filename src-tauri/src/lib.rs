//! ITE (Integrated Translation Editor) - Tauri Backend Library
//!
//! Rust 백엔드 라이브러리로, 파일 I/O, SQLite 관리, 시스템 연동을 담당합니다.

pub mod commands;
pub mod db;
pub mod error;
pub mod models;

use std::path::{Path, PathBuf};
use tauri::Manager;

fn is_valid_env_key(key: &str) -> bool {
    if key.is_empty() {
        return false;
    }
    // 관례적으로 ENV 키는 A-Z0-9_ 로 제한 (VITE_*, BRAVE_* 등)
    key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn try_load_env_lenient(path: &Path) -> std::io::Result<usize> {
    let text = std::fs::read_to_string(path)?;
    let mut loaded = 0usize;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        // dotenvy는 markdown 같은 "KEY=VALUE" 외 라인에서 실패할 수 있으므로,
        // lenient 모드에서는 주석/코드펜스/설명 라인을 최대한 무시합니다.
        if line.starts_with('#') || line.starts_with("```") {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if !is_valid_env_key(key) {
            continue;
        }
        // 이미 설정된 값이 "비어있지 않으면" 덮어쓰지 않음.
        // (특정 런처/환경에서 빈 문자열로 미리 주입되는 케이스를 방지)
        if let Ok(existing) = std::env::var(key) {
            if !existing.trim().is_empty() {
                continue;
            }
        }

        let mut value = v.trim().to_string();
        // 간단한 quote 제거 ("..." / '...')
        if (value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\'')) {
            value = value[1..value.len().saturating_sub(1)].to_string();
        }

        std::env::set_var(key, value);
        loaded += 1;
    }

    Ok(loaded)
}

fn find_upwards(start: PathBuf, filename: &str, max_hops: usize) -> Option<PathBuf> {
    let mut cur = start;
    for _ in 0..=max_hops {
        let candidate = cur.join(filename);
        if candidate.exists() {
            return Some(candidate);
        }
        if !cur.pop() {
            break;
        }
    }
    None
}

fn load_env_for_tauri_dev() {
    // 1) 가장 단순한 케이스: CWD 기준 (.env.local)
    if dotenvy::from_filename(".env.local").is_ok() {
        return;
    }

    // 2) CWD가 프로젝트 루트가 아닐 수 있으니, 상위로 올라가며 탐색
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(p) = find_upwards(cwd, ".env.local", 6) {
            candidates.push(p);
        }
    }

    // 3) 실행 파일 위치 기준으로도 탐색 (cargo run/tauri dev 환경 대응)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Some(p) = find_upwards(dir.to_path_buf(), ".env.local", 8) {
                candidates.push(p);
            }
        }
    }

    // 후보 중 하나라도 성공하면 OK
    for p in candidates {
        // strict 파서 우선
        if dotenvy::from_path(&p).is_ok() {
            return;
        }
        // strict 파서가 실패하면(예: markdown 포함), lenient 로더로 보강
        if let Ok(loaded) = try_load_env_lenient(&p) {
            if loaded > 0 {
                return;
            }
        }
    }
}

/// Tauri 앱 실행
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Dev 환경에서 .env.local 을 로드 (Brave Search API 등 비밀키는 프론트에 노출하지 않고 백엔드에서 사용)
            // - .env.local이 markdown(코드펜스 등)을 포함하면 dotenvy(strict)가 실패할 수 있어,
            //   strict 실패 시 lenient(KEY=VALUE 라인만) 로더로 보강합니다.
            // - production에서는 파일이 없을 수 있으므로 실패해도 무시합니다.
            load_env_for_tauri_dev();
            let _ = dotenvy::dotenv();

            // 데이터베이스 초기화
            let app_handle = app.handle();
            let db_path = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir")
                .join("ite.db");

            // DB 디렉토리 생성
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            // 데이터베이스 연결 및 초기화
            let db = db::Database::new(&db_path)?;
            db.initialize()?;

            // 앱 상태로 데이터베이스 관리
            app.manage(db::DbState(std::sync::Mutex::new(db)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::load_project,
            commands::project::save_project,
            commands::block::get_block,
            commands::block::update_block,
            commands::block::split_block,
            commands::block::merge_blocks,
            commands::chat::save_current_chat_session,
            commands::chat::load_current_chat_session,
            commands::chat::save_chat_sessions,
            commands::chat::load_chat_sessions,
            commands::chat::save_chat_project_settings,
            commands::chat::load_chat_project_settings,
            commands::glossary::import_glossary_csv,
            commands::glossary::import_glossary_excel,
            commands::glossary::search_glossary,
            commands::history::create_snapshot,
            commands::history::restore_snapshot,
            commands::history::list_history,
            commands::storage::export_project_file,
            commands::storage::delete_project,
            commands::storage::delete_all_projects,
            commands::storage::import_project_file,
            commands::storage::import_project_file_safe,
            commands::storage::list_project_ids,
            commands::storage::list_recent_projects,
            commands::attachments::attach_file,
            commands::attachments::list_attachments,
            commands::attachments::delete_attachment,
            commands::attachments::read_file_bytes,
            commands::brave_search::brave_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

