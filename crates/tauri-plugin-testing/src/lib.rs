use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Listener, LogicalSize, Manager, Runtime, State,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};
use uuid::Uuid;

const BRIDGE_RESPONSE_EVENT: &str = "plugin:testing://bridge-response";
const BRIDGE_JS: &str = include_str!("../js/bridge.js");

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<BridgePayload>>>>;

struct TestingState {
    pending: PendingMap,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct RpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Deserialize)]
struct AuthMessage {
    #[serde(rename = "type")]
    kind: String,
    token: String,
}

#[derive(Debug, Deserialize)]
struct BridgePayload {
    id: String,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

#[tauri::command]
fn bridge_response(state: State<'_, TestingState>, payload: BridgePayload) -> Result<(), String> {
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "pending map lock poisoned".to_string())?;

    if let Some(tx) = pending.remove(&payload.id) {
        let _ = tx.send(payload);
    }

    Ok(())
}

pub fn init<R: Runtime + 'static>() -> TauriPlugin<R> {
    let enabled = is_enabled();
    let port = std::env::var("TAURI_TEST_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(9876);

    let token = std::env::var("TAURI_TEST_TOKEN").unwrap_or_else(|_| {
        let fallback = "tauri-testing-token".to_string();
        eprintln!("[tauri-plugin-testing] TAURI_TEST_TOKEN not set; using fallback token.");
        fallback
    });

    let pending_map: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    Builder::new("testing")
        .invoke_handler(tauri::generate_handler![bridge_response])
        .js_init_script(BRIDGE_JS)
        .setup(move |app, _api| {
            app.manage(TestingState {
                pending: pending_map.clone(),
            });

            let pending_for_listener = pending_map.clone();
            app.listen(BRIDGE_RESPONSE_EVENT, move |event| {
                if let Ok(payload) = serde_json::from_str::<BridgePayload>(event.payload()) {
                    if let Ok(mut pending) = pending_for_listener.lock() {
                        if let Some(tx) = pending.remove(&payload.id) {
                            let _ = tx.send(payload);
                        }
                    }
                }
            });

            if !enabled {
                eprintln!("[tauri-plugin-testing] Disabled (set TAURI_TESTING_ENABLED=1 and build with --features testing).");
                return Ok(());
            }

            let app_handle = app.clone();
            let pending_for_server = pending_map.clone();
            let token_for_server = token.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = run_server(app_handle, pending_for_server, port, token_for_server).await {
                    eprintln!("[tauri-plugin-testing] WebSocket server stopped: {err}");
                }
            });

            eprintln!("[tauri-plugin-testing] listening on ws://127.0.0.1:{port} (token required)");
            Ok(())
        })
        .build()
}

fn is_enabled() -> bool {
    std::env::var("TAURI_TESTING_ENABLED")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

async fn run_server<R: Runtime + 'static>(
    app: AppHandle<R>,
    pending: PendingMap,
    port: u16,
    token: String,
) -> Result<(), String> {
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("invalid bind address: {e}"))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("failed to bind websocket server: {e}"))?;

    let active_client = Arc::new(AtomicBool::new(false));

    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("accept failed: {e}"))?;

        if active_client.swap(true, Ordering::SeqCst) {
            tauri::async_runtime::spawn(async move {
                if let Ok(mut ws) = accept_async(stream).await {
                    let _ = ws
                        .send(Message::Text(
                            json!({"type":"error","message":"Only one client is allowed"})
                                .to_string()
                                .into(),
                        ))
                        .await;
                    let _ = ws.close(None).await;
                }
            });
            continue;
        }

        let app_handle = app.clone();
        let pending_map = pending.clone();
        let token_value = token.clone();
        let active_flag = active_client.clone();

        tauri::async_runtime::spawn(async move {
            let _ = handle_connection(stream, app_handle, pending_map, token_value).await;
            active_flag.store(false, Ordering::SeqCst);
        });
    }
}

async fn handle_connection<R: Runtime + 'static>(
    stream: TcpStream,
    app: AppHandle<R>,
    pending: PendingMap,
    token: String,
) -> Result<(), String> {
    let mut ws = accept_async(stream)
        .await
        .map_err(|e| format!("ws handshake failed: {e}"))?;

    let auth_message = timeout(Duration::from_secs(10), ws.next())
        .await
        .map_err(|_| "auth timeout".to_string())?
        .ok_or_else(|| "connection closed before auth".to_string())?
        .map_err(|e| format!("auth read failed: {e}"))?;

    let auth_text = match auth_message {
        Message::Text(text) => text,
        _ => {
            let _ = ws
                .send(Message::Text(
                    json!({"type":"error","message":"expected auth message"})
                        .to_string()
                        .into(),
                ))
                .await;
            let _ = ws.close(None).await;
            return Ok(());
        }
    };

    let auth = serde_json::from_str::<AuthMessage>(&auth_text)
        .map_err(|e| format!("invalid auth message: {e}"))?;

    if auth.kind != "auth" || auth.token != token {
        let _ = ws
            .send(Message::Text(
                json!({"type":"error","message":"unauthorized"})
                    .to_string()
                    .into(),
            ))
            .await;
        let _ = ws.close(None).await;
        return Ok(());
    }

    ws.send(Message::Text(json!({"type":"auth_ok"}).to_string().into()))
        .await
        .map_err(|e| format!("failed to write auth response: {e}"))?;

    while let Some(next) = ws.next().await {
        let msg = match next {
            Ok(message) => message,
            Err(err) => return Err(format!("websocket read error: {err}")),
        };

        if msg.is_close() {
            break;
        }

        if !msg.is_text() {
            continue;
        }

        let text = match msg.to_text() {
            Ok(t) => t,
            Err(err) => {
                let parse_err = rpc_error(None, -32700, format!("invalid text frame: {err}"), None);
                let _ = ws
                    .send(Message::Text(
                        serde_json::to_string(&parse_err)
                            .unwrap_or_else(|_| "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"parse error\"}}".to_string())
                            .into(),
                    ))
                    .await;
                continue;
            }
        };

        let request: RpcRequest = match serde_json::from_str(text) {
            Ok(req) => req,
            Err(err) => {
                let parse_err = rpc_error(None, -32700, format!("parse error: {err}"), None);
                let _ = ws
                    .send(Message::Text(
                        serde_json::to_string(&parse_err)
                            .unwrap_or_else(|_| "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"parse error\"}}".to_string())
                            .into(),
                    ))
                    .await;
                continue;
            }
        };

        let response = handle_rpc_request(&app, &pending, request).await;
        let encoded = serde_json::to_string(&response)
            .map_err(|e| format!("response serialization failed: {e}"))?;

        ws.send(Message::Text(encoded.into()))
            .await
            .map_err(|e| format!("websocket write error: {e}"))?;
    }

    Ok(())
}

async fn handle_rpc_request<R: Runtime + 'static>(
    app: &AppHandle<R>,
    pending: &PendingMap,
    request: RpcRequest,
) -> RpcResponse {
    let id = request.id.unwrap_or(Value::Null);

    if request.jsonrpc.as_deref() != Some("2.0") {
        return rpc_error(Some(id), -32600, "invalid jsonrpc version", None);
    }

    let method = request.method.as_str();
    let params = &request.params;

    let result = match method {
        "dom.querySelector"
        | "dom.click"
        | "dom.clickByText"
        | "dom.fill"
        | "dom.fillByPlaceholder"
        | "dom.typeContentEditable"
        | "dom.typeContentEditableBySelector"
        | "dom.getText"
        | "dom.waitForSelector"
        | "dom.waitForText"
        | "dom.getPageContent"
        | "dialog.getState"
        | "dialog.setAutoResponse"
        | "dialog.pushResponse"
        | "dialog.clear"
        | "tauri.invoke"
        | "tauri.emit" => call_bridge_method(app, pending, method, params).await,

        "window.getTitle" => window_get_title(app, params),
        "window.getSize" => window_get_size(app, params),
        "window.setSize" => window_set_size(app, params),
        "window.list" => window_list(app),
        "window.maximize" => window_action(app, params, "maximize"),
        "window.minimize" => window_action(app, params, "minimize"),
        "window.close" => window_action(app, params, "close"),
        "window.screenshot" => window_screenshot(params),

        "app.ping" => Ok(json!({ "ok": true })),
        "app.quit" => {
            app.exit(0);
            Ok(json!({ "quitting": true }))
        }

        _ => Err(RpcError {
            code: -32601,
            message: format!("Method not found: {}", method),
            data: None,
        }),
    };

    match result {
        Ok(value) => rpc_result(id, value),
        Err(err) => rpc_error(Some(id), err.code, err.message, err.data),
    }
}

async fn call_bridge_method<R: Runtime + 'static>(
    app: &AppHandle<R>,
    pending: &PendingMap,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    let window = get_target_window(app, params)?;

    window
        .eval(BRIDGE_JS)
        .map_err(|e| rpc_internal(format!("failed to inject bridge script: {e}")))?;

    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<BridgePayload>();

    {
        let mut map = pending
            .lock()
            .map_err(|_| rpc_internal("pending map lock poisoned".to_string()))?;
        map.insert(request_id.clone(), tx);
    }

    let id_json = serde_json::to_string(&request_id)
        .map_err(|e| rpc_internal(format!("failed to encode request id: {e}")))?;
    let method_json = serde_json::to_string(method)
        .map_err(|e| rpc_internal(format!("failed to encode method: {e}")))?;
    let params_json = serde_json::to_string(params)
        .map_err(|e| rpc_internal(format!("failed to encode params: {e}")))?;

    let js = format!(
        "window.__TAURI_TESTING_BRIDGE__.handleRequest({id}, {method}, {params});",
        id = id_json,
        method = method_json,
        params = params_json
    );

    if let Err(err) = window.eval(js) {
        let mut map = pending
            .lock()
            .map_err(|_| rpc_internal("pending map lock poisoned".to_string()))?;
        map.remove(&request_id);
        return Err(rpc_internal(format!("failed to evaluate bridge request: {err}")));
    }

    let timeout_ms = params
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(5000)
        .clamp(100, 120_000);

    let received = timeout(Duration::from_millis(timeout_ms + 500), rx)
        .await
        .map_err(|_| RpcError {
            code: -32001,
            message: format!("timeout waiting for response: {method}"),
            data: None,
        })
        .and_then(|inner| {
            inner.map_err(|_| RpcError {
                code: -32002,
                message: "bridge response channel closed".to_string(),
                data: None,
            })
        })?;

    if let Some(error) = received.error {
        return Err(error);
    }

    Ok(received.result.unwrap_or(Value::Null))
}

fn get_target_window<R: Runtime>(app: &AppHandle<R>, params: &Value) -> Result<tauri::WebviewWindow<R>, RpcError> {
    let label = params
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("main");

    app.get_webview_window(label).ok_or_else(|| RpcError {
        code: -32000,
        message: format!("window not found: {label}"),
        data: None,
    })
}

fn window_get_title<R: Runtime>(app: &AppHandle<R>, params: &Value) -> Result<Value, RpcError> {
    let window = get_target_window(app, params)?;
    let title = window
        .title()
        .map_err(|e| rpc_internal(format!("failed to get title: {e}")))?;

    Ok(json!({ "title": title }))
}

fn window_get_size<R: Runtime>(app: &AppHandle<R>, params: &Value) -> Result<Value, RpcError> {
    let window = get_target_window(app, params)?;
    let size = window
        .inner_size()
        .map_err(|e| rpc_internal(format!("failed to get size: {e}")))?;

    Ok(json!({ "width": size.width, "height": size.height }))
}

fn window_set_size<R: Runtime>(app: &AppHandle<R>, params: &Value) -> Result<Value, RpcError> {
    let width = read_required_f64(params, "width")?;
    let height = read_required_f64(params, "height")?;
    if width <= 0.0 || height <= 0.0 {
        return Err(RpcError {
            code: -32602,
            message: "width/height must be > 0".to_string(),
            data: None,
        });
    }

    let window = get_target_window(app, params)?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| rpc_internal(format!("failed to set size: {e}")))?;

    Ok(json!({ "resized": true, "width": width, "height": height }))
}

fn window_action<R: Runtime>(app: &AppHandle<R>, params: &Value, action: &str) -> Result<Value, RpcError> {
    let window = get_target_window(app, params)?;

    match action {
        "maximize" => window
            .maximize()
            .map_err(|e| rpc_internal(format!("failed to maximize: {e}")))?,
        "minimize" => window
            .minimize()
            .map_err(|e| rpc_internal(format!("failed to minimize: {e}")))?,
        "close" => window
            .close()
            .map_err(|e| rpc_internal(format!("failed to close: {e}")))?,
        _ => {
            return Err(RpcError {
                code: -32601,
                message: format!("unknown window action: {action}"),
                data: None,
            })
        }
    }

    Ok(json!({ "ok": true, "action": action }))
}

fn window_list<R: Runtime>(app: &AppHandle<R>) -> Result<Value, RpcError> {
    let windows = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| {
            let title = window.title().unwrap_or_default();
            json!({ "label": label, "title": title })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "windows": windows }))
}

fn window_screenshot(params: &Value) -> Result<Value, RpcError> {
    #[cfg(target_os = "macos")]
    {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("/tmp/tauri-testing-{}.png", Uuid::new_v4()));

        let status = std::process::Command::new("screencapture")
            .arg("-x")
            .arg(&path)
            .status()
            .map_err(|e| rpc_internal(format!("failed to run screencapture: {e}")))?;

        if !status.success() {
            return Err(rpc_internal("screencapture returned non-zero exit code".to_string()));
        }

        Ok(json!({ "path": path }))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = params;
        Err(RpcError {
            code: -32603,
            message: "window.screenshot is currently implemented for macOS only".to_string(),
            data: None,
        })
    }
}

fn read_required_f64(params: &Value, key: &str) -> Result<f64, RpcError> {
    params
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| RpcError {
            code: -32602,
            message: format!("missing or invalid numeric parameter: {key}"),
            data: None,
        })
}

fn rpc_internal(message: String) -> RpcError {
    RpcError {
        code: -32603,
        message,
        data: None,
    }
}

fn rpc_result(id: Value, result: Value) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn rpc_error(id: Option<Value>, code: i64, message: impl Into<String>, data: Option<Value>) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id: id.unwrap_or(Value::Null),
        result: None,
        error: Some(RpcError {
            code,
            message: message.into(),
            data,
        }),
    }
}
