//! HTTP Proxy (streaming) for AI provider calls from the WebView.
//!
//! WebView fetch가 CORS/네트워크 제약으로 provider API 호출에 실패("Type error")할 수 있다.
//! 이 명령은 LangChain 클라이언트의 fetch를 백엔드(reqwest)로 우회시키기 위한 것으로,
//! 요청을 그대로 대리 수행하고 응답 헤더/바디를 Tauri Channel로 스트리밍한다.
//!
//! 도구 호출 루프·SSE 파싱은 프론트엔드(LangChain)가 그대로 담당하고,
//! 여기서는 네트워크 바이트만 전달한다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use url::Url;

use super::CancelHandle;
use crate::error::{CommandError, CommandResult};

/// 백엔드 프록시를 허용할 호스트 (오픈 프록시화 방지)
const ALLOWED_HOSTS: &[&str] = &[
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
];

/// 리다이렉트 최대 추종 횟수 (각 hop마다 allowlist 재검증)
const MAX_REDIRECT_HOPS: usize = 5;

/// 프록시용 공유 reqwest 클라이언트 (Tauri State로 보관).
///
/// - 커넥션 풀 재사용 (호출마다 Client::new() 방지)
/// - redirect: 각 hop에서 https + allowlist 호스트를 재검증하는 커스텀 정책.
///   허용 호스트의 오픈 리다이렉트를 통한 SSRF를 차단한다.
/// - `read_timeout`은 chunk 간 idle 시간 기준이라 스트리밍(SSE)에 안전하다.
///   전체 timeout은 정상 스트리밍도 끊으므로 사용하지 않는다.
pub struct ProxyHttpClient(pub reqwest::Client);

impl ProxyHttpClient {
    pub fn new() -> Self {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > MAX_REDIRECT_HOPS {
                return attempt.stop();
            }
            let url = attempt.url();
            let host_allowed = url
                .host_str()
                .map(|h| ALLOWED_HOSTS.contains(&h))
                .unwrap_or(false);
            if url.scheme() == "https" && host_allowed {
                attempt.follow()
            } else {
                // 검증 실패 시 3xx 응답을 그대로 반환 (추종하지 않음)
                attempt.stop()
            }
        });
        let client = reqwest::Client::builder()
            .redirect(policy)
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(300))
            .build()
            // builder 실패는 극히 드문 경우이며, 이때는 기본 클라이언트로 degrade한다.
            .unwrap_or_else(|_| reqwest::Client::new());
        Self(client)
    }
}

impl Default for ProxyHttpClient {
    fn default() -> Self {
        Self::new()
    }
}

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
    inner: Mutex<HashMap<String, Arc<CancelHandle>>>,
}

impl HttpProxyRegistry {
    fn register(&self, id: &str) -> Arc<CancelHandle> {
        let mut map = self.inner.lock().expect("http proxy registry poisoned");
        map.entry(id.to_string())
            .or_insert_with(|| Arc::new(CancelHandle::new()))
            .clone()
    }

    fn cancel(&self, id: &str) {
        // 미등록 id에 엔트리를 만들지 않는다.
        // (요청 종료 후 도착한 늦은 cancel이 엔트리를 만들어 영구 잔류하는 누수 방지)
        let map = self.inner.lock().expect("http proxy registry poisoned");
        if let Some(handle) = map.get(id) {
            handle.cancel();
        }
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
    client: &reqwest::Client,
    args: &HttpProxyArgs,
    on_event: &Channel<HttpProxyEvent>,
    cancel: &CancelHandle,
) -> CommandResult<()> {
    validate_url(&args.url)?;

    let method = Method::from_bytes(args.method.to_ascii_uppercase().as_bytes())
        .map_err(|e| proxy_error("HTTP_PROXY_METHOD", format!("잘못된 메서드: {e}")))?;

    let mut request = client
        .request(method, &args.url)
        .headers(build_header_map(&args.headers));
    if let Some(body) = &args.body {
        request = request.body(body.clone());
    }

    // 연결/헤더 대기 중에도 취소가 즉시 반영되도록 select!로 감싼다
    let mut response = tokio::select! {
        _ = cancel.cancelled() => return Ok(()),
        result = request.send() => {
            result.map_err(|e| proxy_error("HTTP_PROXY_NETWORK", e.to_string()))?
        }
    };

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
        if cancel.is_cancelled() {
            return Ok(());
        }
        // chunk 대기 중에도 취소가 즉시 반영되도록 select!로 감싼다.
        // read_timeout(idle 기준) 덕분에 서버 무응답 시에도 유한 시간 내에 반환된다.
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            chunk = response.chunk() => chunk
                .map_err(|e| proxy_error("HTTP_PROXY_NETWORK", e.to_string()))?,
        };
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
    client: State<'_, ProxyHttpClient>,
) -> CommandResult<()> {
    let cancel = registry.register(&args.request_id);
    let result = run_proxy(&client.0, &args, &on_event, &cancel).await;
    registry.remove(&args.request_id);
    result
}

#[tauri::command]
pub fn http_proxy_cancel(request_id: String, registry: State<'_, HttpProxyRegistry>) {
    registry.cancel(&request_id);
}
