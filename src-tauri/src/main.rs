//! ITE (Integrated Translation Editor) - Main Entry Point

// 콘솔 창 숨김 (Windows 릴리즈 빌드)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ite_lib::run()
}

