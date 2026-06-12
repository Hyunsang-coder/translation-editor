//! HTTP Proxy (streaming) for AI provider calls from the WebView.
//!
//! WebView fetch가 CORS/네트워크 제약으로 provider API 호출에 실패("Type error")할 수 있다.
//! 이 명령은 LangChain 클라이언트의 fetch를 백엔드(reqwest)로 우회시키기 위한 것으로,
//! 요청을 그대로 대리 수행하고 응답 헤더/바디를 Tauri Channel로 스트리밍한다.
//!
//! 도구 호출 루프·SSE 파싱은 프론트엔드(LangChain)가 그대로 담당하고,
//! 여기서는 네트워크 바이트만 전달한다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use url::Url;

use crate::error::{CommandError, CommandResult};

/// 백엔드 프록시를 허용할 호스트 (오픈 프록시화 방지)
const ALLOWED_HOSTS: &[&str] = &[
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
];

/// 요청에 그대로 전달하면 안 되는(또는 reqwest가 관리하는) 헤더
fn is_skipped_request_header(name: &str) -> bool {
    matches!(
        name,
        "host" | "content-length" | "connection" | "accept-encoding"
    )
}

/// 응답에서 프론트로 넘기면 스트림 재구성과 충돌하는 헤더
fn is_skipped_response_header(name: &str) -> bool {
    matches!(name, "content-encoding" | "content-length" | "transfer-encoding")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxyArgs {
    pub request_id: String,
    pub method: String,
    pub url: String,
    /// [name, value] 헤더 목록
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HttpProxyEvent {
    Head {
        status: u16,
        status_text: String,
        headers: Vec<(String, String)>,
    },
    /// 응답 바디 청크 (base64)
    Chunk {
        base64: String,
    },
    End,
}

#[derive(Default)]
pub struct HttpProxyRegistry {
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl HttpProxyRegistry {
    fn register(&self, id: &str) -> Arc<AtomicBool> {
        let mut map = self.inner.lock().expect("http proxy registry poisoned");
        map.entry(id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    }

    fn cancel(&self, id: &str) {
        let mut map = self.inner.lock().expect("http proxy registry poisoned");
        map.entry(id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .store(true, Ordering::SeqCst);
    }

    fn remove(&self, id: &str) {
        let mut map = self.inner.lock().expect("http proxy registry poisoned");
        map.remove(id);
    }
}

fn proxy_error(code: &str, message: impl Into<String>) -> CommandError {
    CommandError {
        code: code.to_string(),
        message: message.into(),
        details: None,
    }
}

fn validate_url(raw: &str) -> CommandResult<()> {
    let parsed = Url::parse(raw)
        .map_err(|e| proxy_error("HTTP_PROXY_BAD_URL", format!("잘못된 URL: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(proxy_error(
            "HTTP_PROXY_SCHEME",
            "https 요청만 허용됩니다.",
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| proxy_error("HTTP_PROXY_HOST", "호스트를 확인할 수 없습니다."))?;
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(proxy_error(
            "HTTP_PROXY_HOST_NOT_ALLOWED",
            format!("허용되지 않은 호스트입니다: {host}"),
        ));
    }
    Ok(())
}

fn build_header_map(headers: &[(String, String)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if is_skipped_request_header(&lower) {
            continue;
        }
        if let (Ok(header_name), Ok(header_value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            map.insert(header_name, header_value);
        }
    }
    // 압축 응답을 받으면 별도 디코딩이 필요하므로 비압축으로 강제
    map.insert(
        reqwest::header::ACCEPT_ENCODING,
        HeaderValue::from_static("identity"),
    );
    map
}

async fn run_proxy(
    args: &HttpProxyArgs,
    on_event: &Channel<HttpProxyEvent>,
    cancel: &Arc<AtomicBool>,
) -> CommandResult<()> {
    validate_url(&args.url)?;

    let method = Method::from_bytes(args.method.to_ascii_uppercase().as_bytes())
        .map_err(|e| proxy_error("HTTP_PROXY_METHOD", format!("잘못된 메서드: {e}")))?;

    let client = reqwest::Client::new();
    let mut request = client
        .request(method, &args.url)
        .headers(build_header_map(&args.headers));
    if let Some(body) = &args.body {
        request = request.body(body.clone());
    }

    let mut response = request
        .send()
        .await
        .map_err(|e| proxy_error("HTTP_PROXY_NETWORK", e.to_string()))?;

    // Head 이벤트: 상태/헤더 먼저 전달
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let mut header_pairs = Vec::new();
    for (name, value) in response.headers().iter() {
        let key = name.as_str().to_string();
        if is_skipped_response_header(&key.to_ascii_lowercase()) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            header_pairs.push((key, v.to_string()));
        }
    }
    on_event
        .send(HttpProxyEvent::Head {
            status: status.as_u16(),
            status_text,
            headers: header_pairs,
        })
        .map_err(|e| proxy_error("HTTP_PROXY_CHANNEL", e.to_string()))?;

    // 바디 스트리밍
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(());
        }
        let chunk = response
            .chunk()
            .await
            .map_err(|e| proxy_error("HTTP_PROXY_NETWORK", e.to_string()))?;
        let Some(bytes) = chunk else { break };
        if bytes.is_empty() {
            continue;
        }
        let encoded = BASE64.encode(&bytes);
        if on_event
            .send(HttpProxyEvent::Chunk { base64: encoded })
            .is_err()
        {
            // 프론트가 더 이상 수신하지 않으면 중단
            return Ok(());
        }
    }

    let _ = on_event.send(HttpProxyEvent::End);
    Ok(())
}

#[tauri::command]
pub async fn http_proxy_stream(
    args: HttpProxyArgs,
    on_event: Channel<HttpProxyEvent>,
    registry: State<'_, HttpProxyRegistry>,
) -> CommandResult<()> {
    let cancel = registry.register(&args.request_id);
    let result = run_proxy(&args, &on_event, &cancel).await;
    registry.remove(&args.request_id);
    result
}

#[tauri::command]
pub fn http_proxy_cancel(request_id: String, registry: State<'_, HttpProxyRegistry>) {
    registry.cancel(&request_id);
}
