use tauri::{AppHandle, State};
use uuid::Uuid;
use crate::db::{DbState, McpServerRow};
use crate::error::IteError;

#[tauri::command]
pub async fn save_mcp_server(
    app: AppHandle,
    state: State<'_, DbState>,
    name: String,
    server_type: String,
    config_json: String,
    is_enabled: bool,
    id: Option<String>,
) -> Result<String, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    
    let server_id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = chrono::Utc::now().timestamp_millis();

    let server = McpServerRow {
        id: server_id.clone(),
        name,
        server_type,
        config_json,
        is_enabled,
        created_at: now, // 신규 생성 시에는 now, 업데이트 시에는 기존 값을 유지해야 하지만 DB 레이어에서 ON CONFLICT 시 created_at은 건드리지 않으므로 괜찮음 (단, created_at 필드는 필수이므로 넣어줌)
        updated_at: now,
    };

    db.save_mcp_server(&server).map_err(|e| e.to_string())?;
    
    Ok(server_id)
}

#[tauri::command]
pub async fn list_mcp_servers(
    state: State<'_, DbState>,
) -> Result<Vec<McpServerRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let servers = db.list_mcp_servers().map_err(|e| e.to_string())?;
    Ok(servers)
}

#[tauri::command]
pub async fn delete_mcp_server(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.delete_mcp_server(&id).map_err(|e| e.to_string())?;
    Ok(())
}

