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
/// 호출마다 `Client::new()`를 만들면 커넥션 풀이 재사용되지 않으므로 하나를 공유한다.
/// - `connect_timeout`: TCP/TLS 연결 지연을 유한하게 제한
/// - `read_timeout`: chunk 간 idle 시간 기준이라 스트리밍(SSE)에 안전하다.
///   전체 timeout은 정상 스트리밍도 중간에 끊으므로 사용하지 않는다.
pub struct AiHttpClient(pub reqwest::Client);

impl AiHttpClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(300))
            .build()
            // builder 실패는 시스템 TLS 백엔드 문제 등 극히 드문 경우이며,
            // 이때는 timeout 없는 기본 클라이언트로 degrade한다.
            .unwrap_or_else(|_| reqwest::Client::new());
        Self(client)
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

async fn complete_anthropic(client: &reqwest::Client, args: &AiCompleteArgs) -> CommandResult<String> {
    let (system, messages) = split_anthropic_messages(&args.messages);
    let mut body = json!({
        "model": args.model,
        "max_tokens": args.max_tokens,
        "messages": messages,
    });

    if let Some(system) = system {
        body["system"] = Value::String(system);
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

    Ok(content)
}

async fn complete_openai(client: &reqwest::Client, args: &AiCompleteArgs) -> CommandResult<String> {
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

    Ok(content)
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

    let text = match args.provider.as_str() {
        "anthropic" => complete_anthropic(&client.0, &args).await?,
        "openai" => complete_openai(&client.0, &args).await?,
        other => {
            return Err(command_error(
                "AI_PROVIDER_UNSUPPORTED",
                format!("지원하지 않는 AI provider입니다: {other}"),
                None,
            ))
        }
    };

    Ok(AiCompleteResponse { text })
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
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Delta { text: String },
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
        body["system"] = Value::String(system);
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
    loop {
        if cancel.is_cancelled() {
            return Ok(acc);
        }
        // chunk 대기 중에도 취소가 즉시 반영되도록 select!로 감싼다.
        // read_timeout(idle 기준) 덕분에 서버 무응답 시에도 유한 시간 내에 반환된다.
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return Ok(acc),
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

    Ok(acc)
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
    loop {
        if cancel.is_cancelled() {
            return Ok(acc);
        }
        let chunk = tokio::select! {
            _ = cancel.cancelled() => return Ok(acc),
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
                return Ok(acc);
            }
            let value: Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };
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

    Ok(acc)
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
        "anthropic" => stream_anthropic(&client.0, &args, &on_event, &cancel).await,
        "openai" => stream_openai(&client.0, &args, &on_event, &cancel).await,
        other => Err(command_error(
            "AI_PROVIDER_UNSUPPORTED",
            format!("지원하지 않는 AI provider입니다: {other}"),
            None,
        )),
    };
    registry.remove(&args.stream_id);

    let text = result?;
    Ok(AiCompleteResponse { text })
}

#[tauri::command]
pub fn ai_stream_cancel(stream_id: String, registry: State<'_, AiStreamRegistry>) {
    registry.cancel(&stream_id);
}
