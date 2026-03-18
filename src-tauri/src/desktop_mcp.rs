use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::{
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, Runtime, State};
use tracing::{info, warn};

const BRIDGE_ENABLED_ENV: &str = "ODDEYES_BRIDGE_ENABLED";
const BRIDGE_PORT_ENV: &str = "ODDEYES_BRIDGE_PORT";
const BRIDGE_TOKEN_ENV: &str = "ODDEYES_BRIDGE_TOKEN";
const MCP_TRANSPORT_ENV: &str = "ODDEYES_DESKTOP_MCP_TRANSPORT";
const MCP_PORT_ENV: &str = "ODDEYES_DESKTOP_MCP_PORT";
const MCP_AUTH_TOKEN_ENV: &str = "ODDEYES_DESKTOP_MCP_AUTH_TOKEN";
const MCP_HOST_ENV: &str = "ODDEYES_DESKTOP_MCP_HOST";
const MCP_PATH_ENV: &str = "ODDEYES_DESKTOP_MCP_PATH";
const MCP_HEALTH_PATH_ENV: &str = "ODDEYES_DESKTOP_MCP_HEALTH_PATH";
const MCP_DEFAULT_HOST: &str = "127.0.0.1";
const MCP_DEFAULT_PATH: &str = "/mcp";
const MCP_DEFAULT_HEALTH_PATH: &str = "/health";
const MCP_SERVER_DIR: &str = "desktop-mcp";
const MCP_LAUNCHER_BASENAME: &str = "run-oddeyes-desktop-mcp";
const MCP_CONFIG_FILENAME: &str = "claude-desktop-config.json";

#[derive(Debug, Clone)]
pub struct DesktopMcpRuntime {
    pub bridge_port: u16,
    pub bridge_token: String,
    pub helper_port: u16,
    pub helper_auth_token: String,
}

pub struct DesktopMcpState {
    runtime: DesktopMcpRuntime,
    child: Mutex<Option<Child>>,
    launcher_path: Mutex<Option<PathBuf>>,
    config_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Serialize)]
pub struct DesktopMcpStatus {
    bridge_port: u16,
    helper_port: u16,
    helper_url: String,
    launcher_path: Option<String>,
    config_path: Option<String>,
    helper_running: bool,
}

impl DesktopMcpState {
    pub fn new(runtime: DesktopMcpRuntime) -> Self {
        Self {
            runtime,
            child: Mutex::new(None),
            launcher_path: Mutex::new(None),
            config_path: Mutex::new(None),
        }
    }

    fn set_paths(&self, launcher_path: PathBuf, config_path: PathBuf) {
        if let Ok(mut slot) = self.launcher_path.lock() {
            *slot = Some(launcher_path);
        }
        if let Ok(mut slot) = self.config_path.lock() {
            *slot = Some(config_path);
        }
    }

    fn helper_running(&self) -> bool {
        let Ok(mut guard) = self.child.lock() else {
            return false;
        };

        let Some(child) = guard.as_mut() else {
            return false;
        };

        match child.try_wait() {
            Ok(Some(_)) => {
                let _ = guard.take();
                false
            }
            Ok(None) => true,
            Err(_) => false,
        }
    }

    fn replace_child(&self, child: Child) {
        self.kill_child();
        if let Ok(mut slot) = self.child.lock() {
            *slot = Some(child);
        }
    }

    fn kill_child(&self) {
        let Ok(mut slot) = self.child.lock() else {
            return;
        };

        let Some(mut child) = slot.take() else {
            return;
        };

        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
pub fn get_oddeyes_desktop_mcp_status(
    state: State<'_, DesktopMcpState>,
) -> Result<DesktopMcpStatus, String> {
    let launcher_path = state
        .launcher_path
        .lock()
        .map_err(|_| "launcher path lock poisoned".to_string())?
        .clone()
        .map(|path| path.display().to_string());
    let config_path = state
        .config_path
        .lock()
        .map_err(|_| "config path lock poisoned".to_string())?
        .clone()
        .map(|path| path.display().to_string());

    Ok(DesktopMcpStatus {
        bridge_port: state.runtime.bridge_port,
        helper_port: state.runtime.helper_port,
        helper_url: helper_url(&state.runtime),
        launcher_path,
        config_path,
        helper_running: state.helper_running(),
    })
}

pub fn configure_runtime_env() -> DesktopMcpRuntime {
    let bridge_port = env_u16(BRIDGE_PORT_ENV).unwrap_or_else(|| random_free_port(9966));
    let bridge_token =
        std::env::var(BRIDGE_TOKEN_ENV).unwrap_or_else(|_| random_token(32));
    let helper_port = env_u16(MCP_PORT_ENV).unwrap_or_else(|| random_free_port(9977));
    let helper_auth_token =
        std::env::var(MCP_AUTH_TOKEN_ENV).unwrap_or_else(|_| random_token(32));

    std::env::set_var(BRIDGE_ENABLED_ENV, "1");
    std::env::set_var(BRIDGE_PORT_ENV, bridge_port.to_string());
    std::env::set_var(BRIDGE_TOKEN_ENV, &bridge_token);
    std::env::set_var(MCP_PORT_ENV, helper_port.to_string());
    std::env::set_var(MCP_AUTH_TOKEN_ENV, &helper_auth_token);
    std::env::set_var(MCP_HOST_ENV, MCP_DEFAULT_HOST);
    std::env::set_var(MCP_PATH_ENV, MCP_DEFAULT_PATH);
    std::env::set_var(MCP_HEALTH_PATH_ENV, MCP_DEFAULT_HEALTH_PATH);

    DesktopMcpRuntime {
        bridge_port,
        bridge_token,
        helper_port,
        helper_auth_token,
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

    let helper_entry = prepare_installation(&install_dir, &state.runtime)?;
    let launcher_path = launcher_path(&install_dir);
    let config_path = install_dir.join(MCP_CONFIG_FILENAME);
    state.set_paths(launcher_path.clone(), config_path.clone());

    let child = spawn_helper_process(&helper_entry, &state.runtime)?;
    state.replace_child(child);

    if let Err(err) = tauri::async_runtime::block_on(wait_for_helper_health(&state.runtime)) {
        state.kill_child();
        return Err(err);
    }

    info!(
        "[desktop-mcp] helper ready at {} (launcher: {})",
        helper_url(&state.runtime),
        launcher_path.display()
    );

    Ok(())
}

pub fn cleanup<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<DesktopMcpState>() {
        state.kill_child();
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
    TcpListener::bind((MCP_DEFAULT_HOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(fallback)
}

fn helper_url(runtime: &DesktopMcpRuntime) -> String {
    format!(
        "http://{}:{}{}",
        MCP_DEFAULT_HOST, runtime.helper_port, MCP_DEFAULT_PATH
    )
}

fn launcher_path(install_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        install_dir.join(format!("{MCP_LAUNCHER_BASENAME}.cmd"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        install_dir.join(format!("{MCP_LAUNCHER_BASENAME}.sh"))
    }
}

fn prepare_installation(
    install_dir: &Path,
    runtime: &DesktopMcpRuntime,
) -> Result<PathBuf, String> {
    fs::create_dir_all(install_dir)
        .map_err(|e| format!("Failed to create desktop MCP directory: {e}"))?;

    let server_entry = resolve_server_entry_path()?;

    let launcher = launcher_path(install_dir);
    write_launcher_script(&launcher, runtime, &server_entry)?;
    write_claude_desktop_config(&install_dir.join(MCP_CONFIG_FILENAME), &launcher)?;

    Ok(server_entry)
}

fn resolve_server_entry_path() -> Result<PathBuf, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Failed to resolve repository root".to_string())?
        .to_path_buf();
    let entry = repo_root.join("oddeyes-desktop-mcp").join("dist").join("index.js");

    if !entry.exists() {
        return Err(format!(
            "Desktop MCP bundle is missing. Run `npm run oddeyes-desktop-mcp:build` first. Expected {}",
            entry.display()
        ));
    }

    Ok(entry)
}

fn write_launcher_script(
    path: &Path,
    runtime: &DesktopMcpRuntime,
    server_entry: &Path,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let contents = format!(
        "@echo off\r\nset ODDEYES_BRIDGE_PORT={bridge_port}\r\nset ODDEYES_BRIDGE_TOKEN={bridge_token}\r\nset ODDEYES_DESKTOP_MCP_TRANSPORT=stdio\r\nnode \"{server_entry}\"\r\n",
        bridge_port = runtime.bridge_port,
        bridge_token = runtime.bridge_token,
        server_entry = server_entry.display(),
    );

    #[cfg(not(target_os = "windows"))]
    let contents = format!(
        "#!/bin/sh\nset -eu\nexec /usr/bin/env \\\n  {bridge_port_env}='{bridge_port}' \\\n  {bridge_token_env}='{bridge_token}' \\\n  {transport_env}='stdio' \\\n  node \"{server_entry}\"\n",
        bridge_port_env = BRIDGE_PORT_ENV,
        bridge_port = runtime.bridge_port,
        bridge_token_env = BRIDGE_TOKEN_ENV,
        bridge_token = runtime.bridge_token,
        transport_env = MCP_TRANSPORT_ENV,
        server_entry = server_entry.display(),
    );

    fs::write(path, contents)
        .map_err(|e| format!("Failed to write desktop MCP launcher: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path)
            .map_err(|e| format!("Failed to stat desktop MCP launcher: {e}"))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)
            .map_err(|e| format!("Failed to chmod desktop MCP launcher: {e}"))?;
    }

    Ok(())
}

fn write_claude_desktop_config(config_path: &Path, launcher_path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let config = serde_json::json!({
        "mcpServers": {
            "oddeyes": {
                "command": "cmd",
                "args": ["/C", launcher_path.display().to_string()],
            }
        }
    });

    #[cfg(not(target_os = "windows"))]
    let config = serde_json::json!({
        "mcpServers": {
            "oddeyes": {
                "command": "/bin/sh",
                "args": [launcher_path.display().to_string()],
            }
        }
    });

    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize Claude Desktop config: {e}"))?;
    fs::write(config_path, serialized)
        .map_err(|e| format!("Failed to write Claude Desktop config: {e}"))?;

    Ok(())
}

fn spawn_helper_process(
    helper_entry: &Path,
    runtime: &DesktopMcpRuntime,
) -> Result<Child, String> {
    if !helper_entry.exists() {
        return Err(format!(
            "Desktop MCP helper entry is missing: {}",
            helper_entry.display()
        ));
    }

    Command::new("node")
        .arg(helper_entry)
        .env(BRIDGE_PORT_ENV, runtime.bridge_port.to_string())
        .env(BRIDGE_TOKEN_ENV, &runtime.bridge_token)
        .env(MCP_TRANSPORT_ENV, "http")
        .env(MCP_HOST_ENV, MCP_DEFAULT_HOST)
        .env(MCP_PORT_ENV, runtime.helper_port.to_string())
        .env(MCP_AUTH_TOKEN_ENV, &runtime.helper_auth_token)
        .env(MCP_PATH_ENV, MCP_DEFAULT_PATH)
        .env(MCP_HEALTH_PATH_ENV, MCP_DEFAULT_HEALTH_PATH)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn desktop MCP helper: {e}"))
}

async fn wait_for_helper_health(runtime: &DesktopMcpRuntime) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|e| format!("Failed to build desktop MCP health client: {e}"))?;
    let health_url = format!(
        "http://{}:{}{}",
        MCP_DEFAULT_HOST, runtime.helper_port, MCP_DEFAULT_HEALTH_PATH
    );

    let mut last_error = String::from("helper did not respond");

    for _ in 0..25 {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => {
                return Ok(());
            }
            Ok(response) => {
                last_error = format!("helper healthcheck returned {}", response.status());
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    warn!(
        "[desktop-mcp] helper healthcheck failed at {}: {}",
        health_url, last_error
    );
    Err(format!("Desktop MCP helper failed healthcheck: {last_error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_expected_claude_desktop_config() {
        let temp = tempdir().unwrap();
        let launcher = launcher_path(temp.path());
        write_claude_desktop_config(&temp.path().join(MCP_CONFIG_FILENAME), &launcher).unwrap();

        let config = fs::read_to_string(temp.path().join(MCP_CONFIG_FILENAME)).unwrap();
        assert!(config.contains("mcpServers"));
        assert!(config.contains("oddeyes"));
    }
}
