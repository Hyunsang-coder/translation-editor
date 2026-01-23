//! OddEyes.ai - Tauri Backend Library
//! (Internal codename: ITE / Integrated Translation Editor)
//!
//! Rust 백엔드 라이브러리로, 파일 I/O, SQLite 관리, 시스템 연동을 담당합니다.

pub mod commands;
pub mod db;
pub mod error;
pub mod mcp;
pub mod models;
pub mod notion;
pub mod secrets;
pub mod utils;

use std::path::{Path, PathBuf};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
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
        .plugin(tauri_plugin_updater::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Dev 환경에서 .env.local 을 로드 (Brave Search API 등 비밀키는 프론트에 노출하지 않고 백엔드에서 사용)
            // - .env.local이 markdown(코드펜스 등)을 포함하면 dotenvy(strict)가 실패할 수 있어,
            //   strict 실패 시 lenient(KEY=VALUE 라인만) 로더로 보강합니다.
            // - production에서는 파일이 없을 수 있으므로 실패해도 무시합니다.
            load_env_for_tauri_dev();
            let _ = dotenvy::dotenv();

            // 데이터베이스 초기화
            let app_handle = app.handle();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            let db_path = app_data_dir.join("ite.db");

            // DB 디렉토리 생성
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            // 데이터베이스 연결 및 초기화
            let db = db::Database::new(&db_path)?;
            db.initialize()?;

            // 앱 상태로 데이터베이스 관리
            app.manage(db::DbState(std::sync::Mutex::new(db)));

            // SecretManager에 app_data_dir 설정 (Vault 경로용)
            // 동기 실행: 프론트엔드의 initializeSecrets()보다 먼저 완료되어야 함
            tauri::async_runtime::block_on(async {
                secrets::SECRETS.set_app_data_dir(app_data_dir.clone()).await;
            });

            // 앱 시작 시 오래된 임시 이미지 파일 정리 (24시간 이상 경과된 파일)
            if let Ok(deleted) = commands::attachments::cleanup_temp_images() {
                if deleted > 0 {
                    eprintln!("[startup] Cleaned up {} old temp image(s)", deleted);
                }
            }

            // 커스텀 메뉴 생성
            let app_menu = SubmenuBuilder::new(app, "OddEyes")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let reload_item = MenuItemBuilder::with_id("reload", "Reload This Page")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&reload_item)
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .separator()
                .fullscreen()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            // 메뉴 이벤트 핸들러
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == "reload" {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        // 현재 URL을 가져오고, 실패 시 reload 스킵 (패닉 방지)
                        if let Ok(url) = window.url() {
                            let _ = window.navigate(url);
                        }
                    }
                }
            });

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
            commands::attachments::preview_attachment,
            commands::attachments::read_file_bytes,
            commands::attachments::save_temp_image,
            commands::attachments::cleanup_temp_images,
            commands::secure_store::set_secure_secret,
            commands::secure_store::get_secure_secret,
            commands::secure_store::delete_secure_secret,
            commands::mcp::save_mcp_server,
            commands::mcp::list_mcp_servers,
            commands::mcp::delete_mcp_server,
            // MCP SSE 클라이언트 (Rust 네이티브)
            commands::mcp::mcp_connect,
            commands::mcp::mcp_disconnect,
            commands::mcp::mcp_get_status,
            commands::mcp::mcp_get_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_check_auth,
            commands::mcp::mcp_logout,
            // MCP 레지스트리 (여러 MCP 서버 통합 관리)
            commands::mcp::mcp_registry_status,
            commands::mcp::mcp_registry_connect,
            commands::mcp::mcp_registry_disconnect,
            commands::mcp::mcp_registry_logout,
            commands::mcp::mcp_registry_clear_all,
            commands::mcp::mcp_registry_get_tools,
            commands::mcp::mcp_registry_call_tool,
            commands::mcp::mcp_set_notion_config,
            // 커넥터 (OpenAI 빌트인 + MCP)
            commands::connector::connector_set_token,
            commands::connector::connector_get_token,
            commands::connector::connector_delete_token,
            commands::connector::connector_list_status,
            commands::connector::connector_start_oauth,
            // Notion REST API
            commands::notion::notion_set_token,
            commands::notion::notion_has_token,
            commands::notion::notion_clear_token,
            commands::notion::notion_search,
            commands::notion::notion_get_page,
            commands::notion::notion_get_page_content,
            commands::notion::notion_query_database,
            // Secret Manager
            commands::secrets::secrets_initialize,
            commands::secrets::secrets_get,
            commands::secrets::secrets_get_one,
            commands::secrets::secrets_set,
            commands::secrets::secrets_set_one,
            commands::secrets::secrets_delete,
            commands::secrets::secrets_has,
            commands::secrets::secrets_list_keys,
            commands::secrets::secrets_migrate_legacy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
