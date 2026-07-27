//! AI Provider Proxy Commands
//!
//! WebView fetch can surface provider/network failures as an opaque "Type error".
//! These commands route retry requests through the Tauri backend where CORS does not apply.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use super::CancelHandle;
use crate::error::{CommandError, CommandResult};

/// AI provider 호출용 공유 reqwest 클라이언트 (Tauri State로 보관).
///
/// 호출마다 `Client::new()`를 만들면 커넥션 풀이 재사용되지 않으므로 공유한다.
/// 스트리밍과 단발(non-streaming) 경로는 `read_timeout`의 의미가 달라 클라이언트를 분리한다:
/// - `streaming`: SSE 소비용. `read_timeout`은 chunk 간 idle 시간 기준이라 300s면 안전하고,
///   전체 timeout은 정상 스트리밍도 중간에 끊으므로 두지 않는다.
/// - `oneshot`: `ai_complete`(번역/폴리싱/검수의 백엔드 재시도 경로)용. 단발 응답은 본문이
///   한 번에 도착하므로 `read_timeout`이 곧 first-byte(총 응답) 상한이 된다. reasoning 모델은
///   300s를 넘길 수 있어 짧은 read_timeout이 정상 응답을 끊는다 → connect_timeout만 두고
///   read_timeout은 생략한다.
pub struct AiHttpClient {
    pub streaming: reqwest::Client,
    pub oneshot: reqwest::Client,
}

impl AiHttpClient {
    pub fn new() -> Self {
        let streaming = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(300))
            .build()
            // builder 실패는 시스템 TLS 백엔드 문제 등 극히 드문 경우이며,
            // 이때는 timeout 없는 기본 클라이언트로 degrade한다.
            .unwrap_or_else(|_| reqwest::Client::new());
        let oneshot = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { streaming, oneshot }
    }
}

impl Default for AiHttpClient {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompleteArgs {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<AiMessage>,
    pub temperature: Option<f32>,
    /// Anthropic adaptive thinking (thinking: {type: "adaptive"})
    pub adaptive_thinking: Option<bool>,
    /// Anthropic output_config.effort / OpenAI reasoning_effort
    pub effort: Option<String>,
    /// Anthropic prompt caching: system 블록에 cache_control breakpoint 적용.
    /// 같은 system을 여러 번 재사용하는 호출(검수 청크, 번역 청킹)에서만 켠다.
    pub cache_system: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompleteResponse {
    pub text: String,
    /// provider가 보고한 토큰 사용량. 보고하지 않으면 None.
    pub usage: Option<AiUsage>,
}

/// provider별 usage를 하나의 스키마로 정규화한 값.
///
/// `input_tokens`는 **캐시 read/write를 제외한 순수 입력**이다. provider마다 원본 의미가 달라
/// 정규화가 필요하다.
/// - Anthropic: `input_tokens`가 이미 캐시분을 제외한 값이고 캐시 필드가 따로 온다 → 그대로.
/// - OpenAI: `prompt_tokens`가 캐시분을 **포함한 총합**이고 `cached_tokens`가 그 부분집합이다
///   → `input_tokens = prompt_tokens - cached_tokens`로 빼야 이중 계상되지 않는다.
///   OpenAI는 캐시 write 과금이 없으므로 `cache_creation_input_tokens`는 항상 0이다.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub cache_creation_input_tokens: i64,
}

impl AiUsage {
    fn is_empty(&self) -> bool {
        self.input_tokens == 0
            && self.output_tokens == 0
            && self.cache_read_input_tokens == 0
            && self.cache_creation_input_tokens == 0
    }

    /// Anthropic 스트리밍은 message_start와 message_delta가 모두 "누적 스냅샷"을 보고한다.
    /// 합산하면 캐시 필드가 2배로 계상되므로 필드별 최댓값을 취한다(TS 도구 루프와 동일 규칙).
    fn merge_max(&mut self, other: &AiUsage) {
        self.input_tokens = self.input_tokens.max(other.input_tokens);
        self.output_tokens = self.output_tokens.max(other.output_tokens);
        self.cache_read_input_tokens = self
            .cache_read_input_tokens
            .max(other.cache_read_input_tokens);
        self.cache_creation_input_tokens = self
            .cache_creation_input_tokens
            .max(other.cache_creation_input_tokens);
    }
}

fn json_i64(value: &Value, pointer: &str) -> i64 {
    value.pointer(pointer).and_then(Value::as_i64).unwrap_or(0)
}

/// Anthropic 응답/스트림 이벤트의 usage 블록을 파싱한다.
fn parse_anthropic_usage(value: &Value) -> Option<AiUsage> {
    // 최상위(complete) 또는 message.usage(스트림 message_start) 둘 다 지원.
    let usage = value.get("usage").or_else(|| value.pointer("/message/usage"))?;
    let parsed = AiUsage {
        input_tokens: json_i64(usage, "/input_tokens"),
        output_tokens: json_i64(usage, "/output_tokens"),
        cache_read_input_tokens: json_i64(usage, "/cache_read_input_tokens"),
        cache_creation_input_tokens: json_i64(usage, "/cache_creation_input_tokens"),
    };
    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

/// OpenAI 응답/스트림의 usage 블록을 파싱한다(캐시분을 input에서 분리).
fn parse_openai_usage(value: &Value) -> Option<AiUsage> {
    let usage = value.get("usage").filter(|u| !u.is_null())?;
    let prompt_tokens = json_i64(usage, "/prompt_tokens");
    let cached = json_i64(usage, "/prompt_tokens_details/cached_tokens");
    let parsed = AiUsage {
        // 캐시분을 빼서 Anthropic과 같은 의미(순수 입력)로 맞춘다.
        input_tokens: (prompt_tokens - cached).max(0),
        output_tokens: json_i64(usage, "/completion_tokens"),
        cache_read_input_tokens: cached,
        // OpenAI는 자동 프리픽스 캐싱이라 write 과금이 없다.
        cache_creation_input_tokens: 0,
    };
    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn command_error(code: &str, message: impl Into<String>, details: Option<String>) -> CommandError {
    CommandError {
        code: code.to_string(),
        message: message.into(),
        details,
    }
}

fn provider_error(provider: &str, status: StatusCode, body: &str) -> CommandError {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.pointer("/error/error/message").and_then(Value::as_str))
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            if body.trim().is_empty() {
                format!("{provider} API request failed with status {status}")
            } else {
                body.trim().to_string()
            }
        });

    command_error(
        "AI_PROVIDER_ERROR",
        message,
        Some(format!("{provider} status: {status}")),
    )
}

/// 초기 응답이 429/5xx면 지수 백오프로 재시도한다 (스트리밍 시작 전에만).
///
/// - `Retry-After` 헤더(초 단위)가 있으면 존중한다.
/// - 반환값 `None`은 취소를 뜻한다 (cancel 핸들이 있을 때만 발생).
/// - 스트리밍이 시작된 뒤(chunk 수신 중)에는 재시도하지 않는다: 이 함수는
///   응답 헤더 수신까지만 담당하므로 그 조건이 구조적으로 보장된다.
async fn send_with_retry(
    request: reqwest::RequestBuilder,
    cancel: Option<&CancelHandle>,
) -> CommandResult<Option<reqwest::Response>> {
    // 최초 시도 이후 추가 재시도 횟수 (총 4회 전송)
    const MAX_RETRIES: u32 = 3;
    // Retry-After가 과도하게 커도 이 값 이상 기다리지 않는다
    const MAX_DELAY_SECS: u64 = 30;

    let mut attempt: u32 = 0;
    loop {
        if let Some(c) = cancel {
            if c.is_cancelled() {
                return Ok(None);
            }
        }

        let req = request.try_clone().ok_or_else(|| {
            command_error("AI_REQUEST_ERROR", "AI 요청을 복제할 수 없습니다.", None)
        })?;

        // 연결/헤더 대기 중에도 취소가 즉시 반영되도록 select!로 감싼다
        let send_result = match cancel {
            Some(c) => tokio::select! {
                _ = c.cancelled() => return Ok(None),
                result = req.send() => result,
            },
            None => req.send().await,
        };
        let response =
            send_result.map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

        let status = response.status();
        let retryable = status.as_u16() == 429 || status.is_server_error();
        if !retryable || attempt >= MAX_RETRIES {
            return Ok(Some(response));
        }

        // Retry-After(초) 존중, 없으면 지수 백오프 (1s, 2s, 4s)
        let retry_after_secs = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let delay_secs = retry_after_secs
            .unwrap_or(1u64 << attempt.min(4))
            .min(MAX_DELAY_SECS);
        drop(response);

        tracing::warn!(
            "[AI] Provider returned {} (attempt {}), retrying in {}s...",
            status,
            attempt + 1,
            delay_secs
        );

        let backoff = tokio::time::sleep(Duration::from_secs(delay_secs));
        match cancel {
            Some(c) => tokio::select! {
                _ = c.cancelled() => return Ok(None),
                _ = backoff => {}
            },
            None => backoff.await,
        }
        attempt += 1;
    }
}

fn split_anthropic_messages(messages: &[AiMessage]) -> (Option<String>, Vec<Value>) {
    let mut system_parts = Vec::new();
    let mut request_messages = Vec::new();

    for message in messages {
        match message.role.as_str() {
            "system" => system_parts.push(message.content.clone()),
            "assistant" => request_messages.push(json!({
                "role": "assistant",
                "content": message.content,
            })),
            _ => request_messages.push(json!({
                "role": "user",
                "content": message.content,
            })),
        }
    }

    let system = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };

    (system, request_messages)
}

/// Anthropic body의 system 값 구성.
/// cache_system이면 content 블록 배열 + cache_control breakpoint로 전달해
/// 같은 system을 재사용하는 후속 호출(검수 청크, 번역 청킹)이 캐시 읽기(~0.1×)로 과금되게 한다.
/// 최소 캐시 길이(모델별 1024~4096 토큰) 미달 시 API가 조용히 무시하므로 항상 안전하다.
fn anthropic_system_value(system: String, cache_system: bool) -> Value {
    if cache_system {
        json!([{
            "type": "text",
            "text": system,
            "cache_control": { "type": "ephemeral" },
        }])
    } else {
        Value::String(system)
    }
}

async fn complete_anthropic(
    client: &reqwest::Client,
    args: &AiCompleteArgs,
) -> CommandResult<(String, Option<AiUsage>)> {
    let (system, messages) = split_anthropic_messages(&args.messages);
    let mut body = json!({
        "model": args.model,
        "max_tokens": args.max_tokens,
        "messages": messages,
    });

    if let Some(system) = system {
        body["system"] = anthropic_system_value(system, args.cache_system == Some(true));
    }
    if let Some(temperature) = args.temperature {
        body["temperature"] = json!(temperature);
    }
    if args.adaptive_thinking == Some(true) {
        body["thinking"] = json!({ "type": "adaptive" });
    }
    if let Some(effort) = &args.effort {
        body["output_config"] = json!({ "effort": effort });
    }

    let request = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &args.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body);

    let response = send_with_retry(request, None)
        .await?
        .ok_or_else(|| command_error("AI_CANCELLED", "요청이 취소되었습니다.", None))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

    if !status.is_success() {
        return Err(provider_error("Anthropic", status, &text));
    }

    let value: Value = serde_json::from_str(&text)
        .map_err(|e| command_error("AI_RESPONSE_PARSE_ERROR", e.to_string(), Some(text.clone())))?;
    let content = value
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    if content.trim().is_empty() {
        return Err(command_error(
            "AI_EMPTY_RESPONSE",
            "Anthropic 응답이 비어 있습니다.",
            Some(text),
        ));
    }

    Ok((content, parse_anthropic_usage(&value)))
}

async fn complete_openai(
    client: &reqwest::Client,
    args: &AiCompleteArgs,
) -> CommandResult<(String, Option<AiUsage>)> {
    let messages = args
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect::<Vec<_>>();

    let mut body = json!({
        "model": args.model,
        "messages": messages,
    });

    if args.model.starts_with("gpt-5") {
        body["max_completion_tokens"] = json!(args.max_tokens);
        if let Some(effort) = &args.effort {
            body["reasoning_effort"] = json!(effort);
        }
    } else {
        body["max_tokens"] = json!(args.max_tokens);
        if let Some(temperature) = args.temperature {
            body["temperature"] = json!(temperature);
        }
    }

    let request = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&args.api_key)
        .json(&body);

    let response = send_with_retry(request, None)
        .await?
        .ok_or_else(|| command_error("AI_CANCELLED", "요청이 취소되었습니다.", None))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

    if !status.is_success() {
        return Err(provider_error("OpenAI", status, &text));
    }

    let value: Value = serde_json::from_str(&text)
        .map_err(|e| command_error("AI_RESPONSE_PARSE_ERROR", e.to_string(), Some(text.clone())))?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if content.trim().is_empty() {
        return Err(command_error(
            "AI_EMPTY_RESPONSE",
            "OpenAI 응답이 비어 있습니다.",
            Some(text),
        ));
    }

    Ok((content, parse_openai_usage(&value)))
}

#[tauri::command]
pub async fn ai_complete(
    args: AiCompleteArgs,
    client: State<'_, AiHttpClient>,
) -> CommandResult<AiCompleteResponse> {
    if args.api_key.trim().is_empty() {
        return Err(command_error(
            "AI_API_KEY_MISSING",
            "API 키가 설정되어 있지 않습니다.",
            None,
        ));
    }
    if args.messages.is_empty() {
        return Err(command_error(
            "AI_MESSAGES_EMPTY",
            "AI 요청 메시지가 비어 있습니다.",
            None,
        ));
    }

    let (text, usage) = match args.provider.as_str() {
        "anthropic" => complete_anthropic(&client.oneshot, &args).await?,
        "openai" => complete_openai(&client.oneshot, &args).await?,
        other => {
            return Err(command_error(
                "AI_PROVIDER_UNSUPPORTED",
                format!("지원하지 않는 AI provider입니다: {other}"),
                None,
            ))
        }
    };

    Ok(AiCompleteResponse { text, usage })
}

// ============================================================
// Streaming proxy (SSE)
//
// WebView fetch에 의존하지 않고 백엔드에서 provider SSE를 직접 소비한다.
// 토큰 델타는 Tauri Channel로 프론트엔드에 실시간 전달하고, 최종 전체 텍스트는
// 명령 반환값으로 돌려준다. 취소는 stream_id 기반 레지스트리로 처리한다.
// ============================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamArgs {
    pub stream_id: String,
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<AiMessage>,
    pub temperature: Option<f32>,
    /// Anthropic adaptive thinking (thinking: {type: "adaptive"})
    pub adaptive_thinking: Option<bool>,
    /// Anthropic output_config.effort / OpenAI reasoning_effort
    pub effort: Option<String>,
    /// Anthropic prompt caching: system 블록에 cache_control breakpoint 적용.
    pub cache_system: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Delta { text: String },
    /// 스트림 종료 직전 1회 발행되는 최종 토큰 사용량.
    Usage { usage: AiUsage },
}

/// stream_id별 취소 핸들 레지스트리. (락은 짧게만 잡고 await 구간을 넘기지 않는다)
#[derive(Default)]
pub struct AiStreamRegistry {
    inner: Mutex<HashMap<String, Arc<CancelHandle>>>,
}

impl AiStreamRegistry {
    fn register(&self, id: &str) -> Arc<CancelHandle> {
        let mut map = self.inner.lock().expect("ai stream registry poisoned");
        map.entry(id.to_string())
            .or_insert_with(|| Arc::new(CancelHandle::new()))
            .clone()
    }

    fn cancel(&self, id: &str) {
        // 미등록 id에 엔트리를 만들지 않는다.
        // (스트림 종료 후 도착한 늦은 cancel이 엔트리를 만들어 영구 잔류하는 누수 방지)
        let map = self.inner.lock().expect("ai stream registry poisoned");
        if let Some(handle) = map.get(id) {
            handle.cancel();
        }
    }

    fn remove(&self, id: &str) {
        let mut map = self.inner.lock().expect("ai stream registry poisoned");
        map.remove(id);
    }
}

/// 버퍼에서 개행으로 끝나는 완전한 라인들을 잘라내고, 미완성 잔여분은 버퍼에 남긴다.
fn take_complete_lines(buffer: &mut String) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(idx) = buffer.find('\n') {
        let line: String = buffer.drain(..=idx).collect();
        lines.push(line.trim_end_matches(|c| c == '\r' || c == '\n').to_string());
    }
    lines
}

async fn stream_anthropic(
    client: &reqwest::Client,
    args: &AiStreamArgs,
    on_event: &Channel<AiStreamEvent>,
    cancel: &CancelHandle,
) -> CommandResult<String> {
    let (system, messages) = split_anthropic_messages(&args.messages);
    let mut body = json!({
        "model": args.model,
        "max_tokens": args.max_tokens,
        "messages": messages,
        "stream": true,
    });
    if let Some(system) = system {
        body["system"] = anthropic_system_value(system, args.cache_system == Some(true));
    }
    if let Some(temperature) = args.temperature {
        body["temperature"] = json!(temperature);
    }
    if args.adaptive_thinking == Some(true) {
        body["thinking"] = json!({ "type": "adaptive" });
    }
    if let Some(effort) = &args.effort {
        body["output_config"] = json!({ "effort": effort });
    }

    let request = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &args.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("accept", "text/event-stream")
        .json(&body);

    // 429/5xx는 스트리밍 시작 전에 한해 백오프 재시도. None이면 취소된 것.
    let Some(mut response) = send_with_retry(request, Some(cancel)).await? else {
        return Ok(String::new());
    };

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(provider_error("Anthropic", status, &text));
    }

    let mut acc = String::new();
    let mut buffer = String::new();
    // 취소된 스트림도 생성분만큼 과금되므로, 중단 경로에서도 지금까지의 usage를 발행한다.
    let mut usage_acc = AiUsage::default();
    macro_rules! finish {
        () => {{
            if !usage_acc.is_empty() {
                let _ = on_event.send(AiStreamEvent::Usage {
                    usage: usage_acc.clone(),
                });
            }
            return Ok(acc);
        }};
    }
    loop {
        if cancel.is_cancelled() {
            finish!();
        }
        // chunk 대기 중에도 취소가 즉시 반영되도록 select!로 감싼다.
        // read_timeout(idle 기준) 덕분에 서버 무응답 시에도 유한 시간 내에 반환된다.
        let chunk = tokio::select! {
            _ = cancel.cancelled() => finish!(),
            chunk = response.chunk() => chunk
                .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?,
        };
        let Some(bytes) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        for line in take_complete_lines(&mut buffer) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            // message_start/message_delta 모두 누적 스냅샷이라 필드별 max로 병합한다.
            if let Some(usage) = parse_anthropic_usage(&value) {
                usage_acc.merge_max(&usage);
            }
            match value.get("type").and_then(Value::as_str) {
                Some("content_block_delta") => {
                    if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            acc.push_str(text);
                            let _ = on_event.send(AiStreamEvent::Delta {
                                text: text.to_string(),
                            });
                        }
                    }
                }
                Some("error") => {
                    let message = value
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Anthropic streaming error")
                        .to_string();
                    return Err(command_error("AI_PROVIDER_ERROR", message, None));
                }
                _ => {}
            }
        }
    }

    finish!();
}

async fn stream_openai(
    client: &reqwest::Client,
    args: &AiStreamArgs,
    on_event: &Channel<AiStreamEvent>,
    cancel: &CancelHandle,
) -> CommandResult<String> {
    let messages = args
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect::<Vec<_>>();

    let mut body = json!({
        "model": args.model,
        "messages": messages,
        "stream": true,
        // 이 옵션이 없으면 OpenAI 스트리밍은 usage를 아예 보내지 않는다.
        "stream_options": { "include_usage": true },
    });

    if args.model.starts_with("gpt-5") {
        body["max_completion_tokens"] = json!(args.max_tokens);
        if let Some(effort) = &args.effort {
            body["reasoning_effort"] = json!(effort);
        }
    } else {
        body["max_tokens"] = json!(args.max_tokens);
        if let Some(temperature) = args.temperature {
            body["temperature"] = json!(temperature);
        }
    }

    let request = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&args.api_key)
        .header("accept", "text/event-stream")
        .json(&body);

    // 429/5xx는 스트리밍 시작 전에 한해 백오프 재시도. None이면 취소된 것.
    let Some(mut response) = send_with_retry(request, Some(cancel)).await? else {
        return Ok(String::new());
    };

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(provider_error("OpenAI", status, &text));
    }

    let mut acc = String::new();
    let mut buffer = String::new();
    // 취소된 스트림도 생성분만큼 과금되므로, 중단 경로에서도 지금까지의 usage를 발행한다.
    let mut usage_acc = AiUsage::default();
    macro_rules! finish {
        () => {{
            if !usage_acc.is_empty() {
                let _ = on_event.send(AiStreamEvent::Usage {
                    usage: usage_acc.clone(),
                });
            }
            return Ok(acc);
        }};
    }
    loop {
        if cancel.is_cancelled() {
            finish!();
        }
        let chunk = tokio::select! {
            _ = cancel.cancelled() => finish!(),
            chunk = response.chunk() => chunk
                .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?,
        };
        let Some(bytes) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        for line in take_complete_lines(&mut buffer) {
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                finish!();
            }
            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            // usage 청크는 choices가 비어 있으므로 델타 처리보다 먼저 본다.
            if let Some(usage) = parse_openai_usage(&value) {
                usage_acc.merge_max(&usage);
            }
            if let Some(text) = value
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                if !text.is_empty() {
                    acc.push_str(text);
                    let _ = on_event.send(AiStreamEvent::Delta {
                        text: text.to_string(),
                    });
                }
            }
        }
    }

    finish!();
}

#[tauri::command]
pub async fn ai_stream(
    args: AiStreamArgs,
    on_event: Channel<AiStreamEvent>,
    registry: State<'_, AiStreamRegistry>,
    client: State<'_, AiHttpClient>,
) -> CommandResult<AiCompleteResponse> {
    if args.api_key.trim().is_empty() {
        return Err(command_error(
            "AI_API_KEY_MISSING",
            "API 키가 설정되어 있지 않습니다.",
            None,
        ));
    }
    if args.messages.is_empty() {
        return Err(command_error(
            "AI_MESSAGES_EMPTY",
            "AI 요청 메시지가 비어 있습니다.",
            None,
        ));
    }

    let cancel = registry.register(&args.stream_id);
    let result = match args.provider.as_str() {
        "anthropic" => stream_anthropic(&client.streaming, &args, &on_event, &cancel).await,
        "openai" => stream_openai(&client.streaming, &args, &on_event, &cancel).await,
        other => Err(command_error(
            "AI_PROVIDER_UNSUPPORTED",
            format!("지원하지 않는 AI provider입니다: {other}"),
            None,
        )),
    };
    registry.remove(&args.stream_id);

    let text = result?;
    // 스트리밍 usage는 종료 직전 AiStreamEvent::Usage로 이미 발행됐다.
    // 반환값에 다시 실으면 프런트가 같은 호출을 두 번 계상할 수 있어 None으로 둔다.
    Ok(AiCompleteResponse { text, usage: None })
}

#[tauri::command]
pub fn ai_stream_cancel(stream_id: String, registry: State<'_, AiStreamRegistry>) {
    registry.cancel(&stream_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_system_plain_string_without_cache() {
        let value = anthropic_system_value("규칙".to_string(), false);
        assert_eq!(value, Value::String("규칙".to_string()));
    }

    #[test]
    fn anthropic_system_cache_control_block_with_cache() {
        let value = anthropic_system_value("규칙".to_string(), true);
        let blocks = value.as_array().expect("system은 블록 배열이어야 한다");
        assert_eq!(blocks.len(), 1);
        let block = &blocks[0];
        assert_eq!(block["type"], "text");
        assert_eq!(block["text"], "규칙");
        assert_eq!(block["cache_control"]["type"], "ephemeral");
    }

    #[test]
    fn split_anthropic_messages_extracts_system() {
        let messages = vec![
            AiMessage { role: "system".to_string(), content: "시스템".to_string() },
            AiMessage { role: "user".to_string(), content: "질문".to_string() },
        ];
        let (system, rest) = split_anthropic_messages(&messages);
        assert_eq!(system, Some("시스템".to_string()));
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0]["role"], "user");
    }

    #[test]
    fn anthropic_usage_keeps_cache_fields_separate() {
        let value = json!({
            "usage": {
                "input_tokens": 120,
                "output_tokens": 40,
                "cache_read_input_tokens": 5000,
                "cache_creation_input_tokens": 300
            }
        });
        let usage = parse_anthropic_usage(&value).expect("usage should parse");
        // Anthropic의 input_tokens는 이미 캐시분을 뺀 값이라 그대로 쓴다.
        assert_eq!(usage.input_tokens, 120);
        assert_eq!(usage.output_tokens, 40);
        assert_eq!(usage.cache_read_input_tokens, 5000);
        assert_eq!(usage.cache_creation_input_tokens, 300);
    }

    #[test]
    fn anthropic_usage_reads_stream_message_start_shape() {
        let value = json!({
            "type": "message_start",
            "message": { "usage": { "input_tokens": 10, "output_tokens": 1 } }
        });
        let usage = parse_anthropic_usage(&value).expect("message.usage should parse");
        assert_eq!(usage.input_tokens, 10);
    }

    #[test]
    fn openai_usage_subtracts_cached_tokens_from_input() {
        let value = json!({
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 50,
                "prompt_tokens_details": { "cached_tokens": 800 }
            }
        });
        let usage = parse_openai_usage(&value).expect("usage should parse");
        // prompt_tokens는 캐시분을 포함한 총합이므로 빼지 않으면 이중 계상된다.
        assert_eq!(usage.input_tokens, 200);
        assert_eq!(usage.cache_read_input_tokens, 800);
        assert_eq!(usage.output_tokens, 50);
        // OpenAI는 캐시 write 과금이 없다.
        assert_eq!(usage.cache_creation_input_tokens, 0);
    }

    #[test]
    fn usage_parsers_return_none_when_absent_or_empty() {
        assert!(parse_openai_usage(&json!({ "choices": [] })).is_none());
        assert!(parse_openai_usage(&json!({ "usage": null })).is_none());
        assert!(parse_anthropic_usage(&json!({ "type": "ping" })).is_none());
        // 전부 0이면 기록할 가치가 없으므로 None.
        assert!(parse_anthropic_usage(&json!({ "usage": { "input_tokens": 0 } })).is_none());
    }

    #[test]
    fn merge_max_does_not_double_count_cumulative_snapshots() {
        // Anthropic 스트림: message_start와 message_delta가 같은 캐시 값을 각각 보고한다.
        let mut acc = AiUsage::default();
        acc.merge_max(&AiUsage {
            input_tokens: 4325,
            output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 4323,
        });
        acc.merge_max(&AiUsage {
            input_tokens: 0,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 4323,
        });
        assert_eq!(acc.input_tokens, 4325);
        assert_eq!(acc.output_tokens, 50);
        // 합산했다면 8646이 됐을 값.
        assert_eq!(acc.cache_creation_input_tokens, 4323);
    }
}
