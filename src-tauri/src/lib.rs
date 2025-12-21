//! ITE (Integrated Translation Editor) - Tauri Backend Library
//!
//! Rust 백엔드 라이브러리로, 파일 I/O, SQLite 관리, 시스템 연동을 담당합니다.

pub mod commands;
pub mod db;
pub mod error;
pub mod models;

use tauri::Manager;

/// Tauri 앱 실행
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

