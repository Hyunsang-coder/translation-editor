use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Listener, Manager, Runtime, State,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{ErrorResponse, Request, Response as HandshakeResponse},
        http::StatusCode,
        protocol::Message,
    },
};
use uuid::Uuid;

const BRIDGE_RESPONSE_EVENT: &str = "plugin:oddeyes-bridge://response";
const BRIDGE_JS: &str = include_str!("../js/bridge.js");

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<BridgePayload>>>>;

struct BridgeState {
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
fn bridge_response(state: State<'_, BridgeState>, payload: BridgePayload) -> Result<(), String> {
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
    let port = std::env::var("ODDEYES_BRIDGE_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(9966);
    // 보안: 고정 fallback 토큰은 사용하지 않는다. 운영 경로에서는
    // desktop_mcp::configure_runtime_env()가 플러그인 초기화 전에 항상
    // 랜덤 토큰을 주입하며, 토큰 미설정 시 서버를 기동하지 않는다.
    let token = std::env::var("ODDEYES_BRIDGE_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let pending_map: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    Builder::new("oddeyes-bridge")
        .invoke_handler(tauri::generate_handler![bridge_response])
        .js_init_script(BRIDGE_JS)
        .setup(move |app, _api| {
            app.manage(BridgeState {
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
                return Ok(());
            }

            // 토큰 미설정 시 서버를 기동하지 않는다. 고정 fallback 토큰으로
            // 기동하면 로컬의 다른 프로세스가 인증을 통과할 수 있다.
            let Some(token_for_server) = token else {
                eprintln!(
                    "[tauri-plugin-oddeyes-bridge] ODDEYES_BRIDGE_TOKEN is not set; bridge server will NOT start."
                );
                return Ok(());
            };

            let app_handle = app.clone();
            let pending_for_server = pending_map.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = run_server(app_handle, pending_for_server, port, token_for_server).await {
                    eprintln!("[tauri-plugin-oddeyes-bridge] WebSocket server stopped: {err}");
                }
            });

            eprintln!("[tauri-plugin-oddeyes-bridge] listening on ws://127.0.0.1:{port}");
            Ok(())
        })
        .build()
}

fn is_enabled() -> bool {
    std::env::var("ODDEYES_BRIDGE_ENABLED")
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

    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("accept failed: {e}"))?;

        let app_handle = app.clone();
        let pending_map = pending.clone();
        let token_value = token.clone();
        tauri::async_runtime::spawn(async move {
            let _ = handle_connection(stream, app_handle, pending_map, token_value).await;
        });
    }
}

async fn handle_connection<R: Runtime + 'static>(
    stream: TcpStream,
    app: AppHandle<R>,
    pending: PendingMap,
    token: String,
) -> Result<(), String> {
    let mut ws = accept_hdr_async(stream, origin_guard)
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

    if auth.kind != "auth" || !constant_time_token_eq(&token, &auth.token) {
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
                let _ = ws.send(Message::Text(serde_json::to_string(&parse_err).unwrap().into())).await;
                continue;
            }
        };

        let request: RpcRequest = match serde_json::from_str(text) {
            Ok(req) => req,
            Err(err) => {
                let parse_err = rpc_error(None, -32700, format!("parse error: {err}"), None);
                let _ = ws.send(Message::Text(serde_json::to_string(&parse_err).unwrap().into())).await;
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

/// WebSocket 핸드셰이크 시 Origin 헤더를 검증한다.
/// Origin이 없으면 비브라우저 클라이언트(Claude Desktop MCP 서버 등)로 간주해
/// 허용하고, 있으면 Tauri 앱/dev 서버 origin만 허용한다. 그 외 브라우저
/// 페이지는 거부해 악성 웹 페이지가 운영 브리지에 접속하는 것을 차단한다.
fn origin_guard(
    request: &Request,
    response: HandshakeResponse,
) -> Result<HandshakeResponse, ErrorResponse> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());

    if is_allowed_origin(origin) {
        Ok(response)
    } else {
        eprintln!(
            "[tauri-plugin-oddeyes-bridge] rejected websocket connection from disallowed origin: {}",
            origin.unwrap_or("<non-utf8>")
        );
        let mut forbidden = ErrorResponse::new(Some("origin not allowed".to_string()));
        *forbidden.status_mut() = StatusCode::FORBIDDEN;
        Err(forbidden)
    }
}

fn is_allowed_origin(origin: Option<&str>) -> bool {
    const ALLOWED_ORIGINS: [&str; 4] = [
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ];

    match origin {
        None => true,
        Some(value) => ALLOWED_ORIGINS
            .iter()
            .any(|allowed| value.eq_ignore_ascii_case(allowed)),
    }
}

/// 상수 시간 토큰 비교. 일치 여부와 무관하게 기대 토큰 길이만큼 항상
/// XOR 누적을 수행한다. 길이가 달라도 즉시 반환하지 않고 더미 바이트(0)와
/// 비교를 계속한 뒤 길이 차이를 결과에 반영해 타이밍 부채널을 줄인다.
fn constant_time_token_eq(expected: &str, provided: &str) -> bool {
    let expected_bytes = expected.as_bytes();
    let provided_bytes = provided.as_bytes();

    let mut diff = expected_bytes.len() ^ provided_bytes.len();
    for (index, expected_byte) in expected_bytes.iter().enumerate() {
        let provided_byte = provided_bytes.get(index).copied().unwrap_or(0);
        diff |= usize::from(expected_byte ^ provided_byte);
    }

    diff == 0
}

/// 타임아웃/에러 경로에서 pending map 엔트리를 정리해 누수를 방지한다.
/// 운영 브리지는 프로덕션에서 상시 활성이므로, webview reload나 JS 예외로
/// 응답이 오지 않는 요청의 엔트리가 HashMap에 영구 누적되는 것을 막는다.
fn remove_pending_entry(pending: &PendingMap, request_id: &str) {
    if let Ok(mut map) = pending.lock() {
        map.remove(request_id);
    }
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
        "app.ping" => Ok(json!({ "ok": true })),
        "app.quit" => {
            app.exit(0);
            Ok(json!({ "quitting": true }))
        }
        _ if method.starts_with("oddeyes.") => call_bridge_method(app, pending, method, params).await,
        _ => Err(RpcError {
            code: -32601,
            message: format!("Method not found: {method}"),
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
    let window = app.get_webview_window("main").ok_or_else(|| RpcError {
        code: -32000,
        message: "window not found: main".to_string(),
        data: None,
    })?;

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

    let js = format!(
        "window.__ODDEYES_RUNTIME_BRIDGE__.handleRequest({id}, {method}, {params});",
        id = serde_json::to_string(&request_id).map_err(|e| rpc_internal(e.to_string()))?,
        method = serde_json::to_string(method).map_err(|e| rpc_internal(e.to_string()))?,
        params = serde_json::to_string(params).map_err(|e| rpc_internal(e.to_string()))?,
    );

    if let Err(err) = window.eval(js) {
        let mut map = pending
            .lock()
            .map_err(|_| rpc_internal("pending map lock poisoned".to_string()))?;
        map.remove(&request_id);
        return Err(rpc_internal(format!("failed to evaluate bridge request: {err}")));
    }

    let received = match timeout(Duration::from_millis(10_500), rx).await {
        Ok(Ok(payload)) => payload,
        Ok(Err(_)) => {
            // 채널이 닫힌 경우에도 pending 엔트리가 남아 있을 수 있으므로 정리한다.
            remove_pending_entry(pending, &request_id);
            return Err(RpcError {
                code: -32002,
                message: "bridge response channel closed".to_string(),
                data: None,
            });
        }
        Err(_) => {
            // 타임아웃 시 pending 엔트리를 제거해 HashMap 영구 누적을 방지한다.
            remove_pending_entry(pending, &request_id);
            return Err(RpcError {
                code: -32001,
                message: format!("timeout waiting for response: {method}"),
                data: None,
            });
        }
    };

    if let Some(error) = received.error {
        return Err(error);
    }

    Ok(received.result.unwrap_or(Value::Null))
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

fn rpc_internal(message: impl Into<String>) -> RpcError {
    RpcError {
        code: -32603,
        message: message.into(),
        data: None,
    }
}
