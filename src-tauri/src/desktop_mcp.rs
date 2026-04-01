use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::{
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime, State};
use tracing::info;

const BRIDGE_ENABLED_ENV: &str = "ODDEYES_BRIDGE_ENABLED";
const BRIDGE_PORT_ENV: &str = "ODDEYES_BRIDGE_PORT";
const BRIDGE_TOKEN_ENV: &str = "ODDEYES_BRIDGE_TOKEN";
const MCP_SERVER_DIR: &str = "desktop-mcp";
const MCP_EXTENSION_RESOURCE_PATH: &str = "_up_/oddeyes-desktop-mcp/build/oddeyes-desktop.mcpb";
const MCP_EXTENSION_FILENAME: &str = "oddeyes-desktop.mcpb";
const MCP_BRIDGE_INFO_DIR: &str = "runtime";
const MCP_BRIDGE_INFO_FILENAME: &str = "bridge.json";
const MCP_LEGACY_CONFIG_FILENAME: &str = "claude-desktop-config.json";
const MCP_LEGACY_LAUNCHER_SH: &str = "run-oddeyes-desktop-mcp.sh";
const MCP_LEGACY_LAUNCHER_CMD: &str = "run-oddeyes-desktop-mcp.cmd";
const MCP_LEGACY_SERVER_DIR: &str = "server";

#[derive(Debug, Clone)]
pub struct DesktopMcpRuntime {
    pub bridge_port: u16,
    pub bridge_token: String,
}

pub struct DesktopMcpState {
    runtime: DesktopMcpRuntime,
    extension_bundle_path: Mutex<Option<PathBuf>>,
    bridge_info_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Serialize)]
pub struct DesktopMcpStatus {
    bridge_port: u16,
    extension_bundle_path: Option<String>,
    bridge_info_path: Option<String>,
}

impl DesktopMcpState {
    pub fn new(runtime: DesktopMcpRuntime) -> Self {
        Self {
            runtime,
            extension_bundle_path: Mutex::new(None),
            bridge_info_path: Mutex::new(None),
        }
    }

    fn set_paths(&self, extension_bundle_path: PathBuf, bridge_info_path: PathBuf) {
        if let Ok(mut slot) = self.extension_bundle_path.lock() {
            *slot = Some(extension_bundle_path);
        }
        if let Ok(mut slot) = self.bridge_info_path.lock() {
            *slot = Some(bridge_info_path);
        }
    }
}

#[tauri::command]
pub fn get_oddeyes_desktop_mcp_status(
    state: State<'_, DesktopMcpState>,
) -> Result<DesktopMcpStatus, String> {
    let extension_bundle_path = state
        .extension_bundle_path
        .lock()
        .map_err(|_| "extension bundle path lock poisoned".to_string())?
        .clone()
        .map(|path| path.display().to_string());
    let bridge_info_path = state
        .bridge_info_path
        .lock()
        .map_err(|_| "bridge info path lock poisoned".to_string())?
        .clone()
        .map(|path| path.display().to_string());

    Ok(DesktopMcpStatus {
        bridge_port: state.runtime.bridge_port,
        extension_bundle_path,
        bridge_info_path,
    })
}

pub fn configure_runtime_env() -> DesktopMcpRuntime {
    let bridge_port = env_u16(BRIDGE_PORT_ENV).unwrap_or_else(|| random_free_port(9966));
    let bridge_token = std::env::var(BRIDGE_TOKEN_ENV).unwrap_or_else(|_| random_token(32));

    std::env::set_var(BRIDGE_ENABLED_ENV, "1");
    std::env::set_var(BRIDGE_PORT_ENV, bridge_port.to_string());
    std::env::set_var(BRIDGE_TOKEN_ENV, &bridge_token);

    DesktopMcpRuntime {
        bridge_port,
        bridge_token,
    }
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app
        .try_state::<DesktopMcpState>()
        .ok_or_else(|| "Desktop MCP state is not registered".to_string())?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let install_dir = app_data_dir.join(MCP_SERVER_DIR);

    let extension_bundle_path = prepare_installation(app, &install_dir)?;
    let bridge_info_path = install_dir
        .join(MCP_BRIDGE_INFO_DIR)
        .join(MCP_BRIDGE_INFO_FILENAME);
    write_bridge_info(&bridge_info_path, &state.runtime)?;
    state.set_paths(extension_bundle_path.clone(), bridge_info_path.clone());

    info!(
        "[desktop-mcp] extension bundle ready at {}",
        extension_bundle_path.display()
    );

    Ok(())
}

pub fn cleanup<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<DesktopMcpState>() {
        if let Ok(path) = state.bridge_info_path.lock() {
            if let Some(path) = path.as_ref() {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn env_u16(key: &str) -> Option<u16> {
    std::env::var(key).ok()?.parse::<u16>().ok()
}

fn random_token(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn random_free_port(fallback: u16) -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(fallback)
}

fn prepare_installation(
    app: &AppHandle<impl Runtime>,
    install_dir: &Path,
) -> Result<PathBuf, String> {
    fs::create_dir_all(install_dir)
        .map_err(|e| format!("Failed to create desktop MCP directory: {e}"))?;

    let source_bundle = resolve_extension_bundle_source(app)?;
    let target_bundle = install_dir.join(MCP_EXTENSION_FILENAME);

    remove_legacy_installation_artifacts(install_dir);

    fs::copy(&source_bundle, &target_bundle).map_err(|e| {
        format!(
            "Failed to copy desktop MCP extension bundle from {} to {}: {e}",
            source_bundle.display(),
            target_bundle.display()
        )
    })?;

    Ok(target_bundle)
}

fn resolve_extension_bundle_source(app: &AppHandle<impl Runtime>) -> Result<PathBuf, String> {
    let resource_bundle = app
        .path()
        .resolve(MCP_EXTENSION_RESOURCE_PATH, BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve desktop MCP extension resource: {e}"))?;

    if resource_bundle.exists() {
        return Ok(resource_bundle);
    }

    let repo_bundle = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Failed to resolve repository root".to_string())?
        .join("oddeyes-desktop-mcp")
        .join("build")
        .join(MCP_EXTENSION_FILENAME);

    if repo_bundle.exists() {
        return Ok(repo_bundle);
    }

    Err(format!(
        "Desktop MCP extension bundle is missing. Checked app resource {} and repo build {}",
        resource_bundle.display(),
        repo_bundle.display()
    ))
}

fn remove_legacy_installation_artifacts(install_dir: &Path) {
    let _ = fs::remove_file(install_dir.join(MCP_LEGACY_CONFIG_FILENAME));
    let _ = fs::remove_file(install_dir.join(MCP_LEGACY_LAUNCHER_SH));
    let _ = fs::remove_file(install_dir.join(MCP_LEGACY_LAUNCHER_CMD));
    let _ = fs::remove_dir_all(install_dir.join(MCP_LEGACY_SERVER_DIR));
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRuntimeInfo<'a> {
    app_id: &'a str,
    app_name: &'a str,
    bridge_port: u16,
    bridge_token: &'a str,
    updated_at: String,
}

fn write_bridge_info(
    path: &Path,
    runtime: &DesktopMcpRuntime,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create desktop MCP runtime directory: {e}"))?;
    }

    let payload = BridgeRuntimeInfo {
        app_id: "com.oddeyes.desktop",
        app_name: "OddEyes.ai",
        bridge_port: runtime.bridge_port,
        bridge_token: &runtime.bridge_token,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Failed to serialize desktop MCP bridge metadata: {e}"))?;
    fs::write(path, serialized)
        .map_err(|e| format!("Failed to write desktop MCP bridge metadata: {e}"))?;

    Ok(())
}

// ── Claude Desktop config auto-registration ──

/// Claude Desktop의 config 파일 경로를 반환합니다.
fn claude_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(|appdata| {
            PathBuf::from(appdata)
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.config")))
            .map(|config_dir| {
                PathBuf::from(config_dir)
                    .join("Claude")
                    .join("claude_desktop_config.json")
            })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeDesktopMcpRegistration {
    /// Claude Desktop이 설치되지 않음 (config 파일 없음)
    NotInstalled,
    /// 등록되지 않음
    NotRegistered,
    /// 등록됨
    Registered,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopMcpRegistrationStatus {
    pub status: ClaudeDesktopMcpRegistration,
    pub config_path: Option<String>,
}

fn read_claude_config(path: &Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read Claude Desktop config: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Claude Desktop config: {e}"))
}

fn write_claude_config(path: &Path, config: &serde_json::Value) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(path, serialized)
        .map_err(|e| format!("Failed to write Claude Desktop config: {e}"))
}

fn make_status(status: ClaudeDesktopMcpRegistration, path: &Path) -> ClaudeDesktopMcpRegistrationStatus {
    ClaudeDesktopMcpRegistrationStatus {
        status,
        config_path: Some(path.display().to_string()),
    }
}

#[tauri::command]
pub fn check_claude_desktop_mcp_registered() -> Result<ClaudeDesktopMcpRegistrationStatus, String> {
    let config_path = match claude_desktop_config_path() {
        Some(p) => p,
        None => {
            return Ok(ClaudeDesktopMcpRegistrationStatus {
                status: ClaudeDesktopMcpRegistration::NotInstalled,
                config_path: None,
            })
        }
    };

    if !config_path.exists() {
        let dir_exists = config_path.parent().map_or(false, |d| d.exists());
        let status = if dir_exists { ClaudeDesktopMcpRegistration::NotRegistered } else { ClaudeDesktopMcpRegistration::NotInstalled };
        return Ok(make_status(status, &config_path));
    }

    let config = read_claude_config(&config_path)?;
    let registered = config
        .get("mcpServers")
        .and_then(|s| s.get("oddeyes-desktop"))
        .is_some();

    let status = if registered { ClaudeDesktopMcpRegistration::Registered } else { ClaudeDesktopMcpRegistration::NotRegistered };
    Ok(make_status(status, &config_path))
}

#[tauri::command]
pub fn register_claude_desktop_mcp() -> Result<ClaudeDesktopMcpRegistrationStatus, String> {
    let config_path = claude_desktop_config_path()
        .ok_or_else(|| "Cannot determine Claude Desktop config path".to_string())?;

    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            return Err("Claude Desktop is not installed".to_string());
        }
    }

    let mut config: serde_json::Value = if config_path.exists() {
        read_claude_config(&config_path)?
    } else {
        serde_json::json!({})
    };

    let mcp_servers = config
        .as_object_mut()
        .ok_or_else(|| "Claude Desktop config is not a JSON object".to_string())?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    mcp_servers
        .as_object_mut()
        .ok_or_else(|| "mcpServers is not a JSON object".to_string())?
        .insert(
            "oddeyes-desktop".to_string(),
            serde_json::json!({
                "command": "npx",
                "args": ["-y", "oddeyes-desktop-mcp"]
            }),
        );

    write_claude_config(&config_path, &config)?;

    info!(
        "[desktop-mcp] Registered oddeyes-desktop in Claude Desktop config at {}",
        config_path.display()
    );

    Ok(make_status(ClaudeDesktopMcpRegistration::Registered, &config_path))
}

#[tauri::command]
pub fn unregister_claude_desktop_mcp() -> Result<ClaudeDesktopMcpRegistrationStatus, String> {
    let config_path = claude_desktop_config_path()
        .ok_or_else(|| "Cannot determine Claude Desktop config path".to_string())?;

    if !config_path.exists() {
        return Ok(make_status(ClaudeDesktopMcpRegistration::NotRegistered, &config_path));
    }

    let mut config = read_claude_config(&config_path)?;

    if let Some(servers) = config
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
    {
        servers.remove("oddeyes-desktop");
    }

    write_claude_config(&config_path, &config)?;

    info!(
        "[desktop-mcp] Unregistered oddeyes-desktop from Claude Desktop config at {}",
        config_path.display()
    );

    Ok(make_status(ClaudeDesktopMcpRegistration::NotRegistered, &config_path))
}

// ── Claude Code (.mcp.json) auto-registration ──

const CLAUDE_CODE_MCP_FILENAME: &str = ".mcp.json";
const CLAUDE_CODE_MCP_SERVER_KEY: &str = "oddeyes";

fn claude_code_mcp_json_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .join(CLAUDE_CODE_MCP_FILENAME)
}

fn oddeyes_mcp_server_entry() -> serde_json::Value {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_string_lossy()
        .to_string();
    serde_json::json!({
        "command": "node",
        "args": ["tauri-testing-mcp/dist/index.js"],
        "cwd": repo_root,
        "env": {
            "TAURI_TEST_TOKEN": "tauri-testing-token",
            "TAURI_TEST_PORT": "9988"
        }
    })
}

#[tauri::command]
pub fn check_claude_code_mcp_registered() -> Result<ClaudeDesktopMcpRegistrationStatus, String> {
    let config_path = claude_code_mcp_json_path();

    if !config_path.exists() {
        return Ok(make_status(ClaudeDesktopMcpRegistration::NotRegistered, &config_path));
    }

    let config = read_claude_config(&config_path)?;
    let registered = config
        .get("mcpServers")
        .and_then(|s| s.get(CLAUDE_CODE_MCP_SERVER_KEY))
        .is_some();

    let status = if registered {
        ClaudeDesktopMcpRegistration::Registered
    } else {
        ClaudeDesktopMcpRegistration::NotRegistered
    };
    Ok(make_status(status, &config_path))
}

#[tauri::command]
pub fn register_claude_code_mcp() -> Result<ClaudeDesktopMcpRegistrationStatus, String> {
    let config_path = claude_code_mcp_json_path();

    let mut config: serde_json::Value = if config_path.exists() {
        read_claude_config(&config_path)?
    } else {
        serde_json::json!({})
    };

    let mcp_servers = config
        .as_object_mut()
        .ok_or_else(|| "Config is not a JSON object".to_string())?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    mcp_servers
        .as_object_mut()
        .ok_or_else(|| "mcpServers is not a JSON object".to_string())?
        .insert(
            CLAUDE_CODE_MCP_SERVER_KEY.to_string(),
            oddeyes_mcp_server_entry(),
        );

    write_claude_config(&config_path, &config)?;

    info!(
        "[desktop-mcp] Registered {} in Claude Code config at {}",
        CLAUDE_CODE_MCP_SERVER_KEY,
        config_path.display()
    );

    Ok(make_status(ClaudeDesktopMcpRegistration::Registered, &config_path))
}

#[tauri::command]
pub fn unregister_claude_code_mcp() -> Result<ClaudeDesktopMcpRegistrationStatus, String> {
    let config_path = claude_code_mcp_json_path();

    if !config_path.exists() {
        return Ok(make_status(ClaudeDesktopMcpRegistration::NotRegistered, &config_path));
    }

    let mut config = read_claude_config(&config_path)?;

    if let Some(servers) = config
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
    {
        servers.remove(CLAUDE_CODE_MCP_SERVER_KEY);
    }

    write_claude_config(&config_path, &config)?;

    info!(
        "[desktop-mcp] Unregistered {} from Claude Code config at {}",
        CLAUDE_CODE_MCP_SERVER_KEY,
        config_path.display()
    );

    Ok(make_status(ClaudeDesktopMcpRegistration::NotRegistered, &config_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_bridge_metadata() {
        let temp = tempdir().unwrap();
        let runtime = DesktopMcpRuntime {
            bridge_port: 9966,
            bridge_token: "bridge-token".to_string(),
        };
        let bridge_info_path = temp
            .path()
            .join(MCP_BRIDGE_INFO_DIR)
            .join(MCP_BRIDGE_INFO_FILENAME);
        write_bridge_info(&bridge_info_path, &runtime).unwrap();

        let config = fs::read_to_string(bridge_info_path).unwrap();
        assert!(config.contains("bridgePort"));
        assert!(config.contains("bridge-token"));
    }
}
