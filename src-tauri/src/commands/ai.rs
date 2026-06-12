//! AI Provider Proxy Commands
//!
//! WebView fetch can surface provider/network failures as an opaque "Type error".
//! These commands route retry requests through the Tauri backend where CORS does not apply.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{CommandError, CommandResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompleteArgs {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub messages: Vec<AiMessage>,
    pub temperature: Option<f32>,
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

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &args.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

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
    } else {
        body["max_tokens"] = json!(args.max_tokens);
        if let Some(temperature) = args.temperature {
            body["temperature"] = json!(temperature);
        }
    }

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&args.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

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
pub async fn ai_complete(args: AiCompleteArgs) -> CommandResult<AiCompleteResponse> {
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

    let client = reqwest::Client::new();
    let text = match args.provider.as_str() {
        "anthropic" => complete_anthropic(&client, &args).await?,
        "openai" => complete_openai(&client, &args).await?,
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
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Delta { text: String },
}

/// stream_id별 취소 플래그 레지스트리. (락은 짧게만 잡고 await 구간을 넘기지 않는다)
#[derive(Default)]
pub struct AiStreamRegistry {
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AiStreamRegistry {
    fn register(&self, id: &str) -> Arc<AtomicBool> {
        let mut map = self.inner.lock().expect("ai stream registry poisoned");
        map.entry(id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    }

    fn cancel(&self, id: &str) {
        let mut map = self.inner.lock().expect("ai stream registry poisoned");
        map.entry(id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .store(true, Ordering::SeqCst);
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
    cancel: &Arc<AtomicBool>,
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

    let mut response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &args.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(provider_error("Anthropic", status, &text));
    }

    let mut acc = String::new();
    let mut buffer = String::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(acc);
        }
        let chunk = response
            .chunk()
            .await
            .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;
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
    cancel: &Arc<AtomicBool>,
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
    } else {
        body["max_tokens"] = json!(args.max_tokens);
        if let Some(temperature) = args.temperature {
            body["temperature"] = json!(temperature);
        }
    }

    let mut response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&args.api_key)
        .header("accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(provider_error("OpenAI", status, &text));
    }

    let mut acc = String::new();
    let mut buffer = String::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(acc);
        }
        let chunk = response
            .chunk()
            .await
            .map_err(|e| command_error("AI_NETWORK_ERROR", e.to_string(), None))?;
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
    let client = reqwest::Client::new();
    let result = match args.provider.as_str() {
        "anthropic" => stream_anthropic(&client, &args, &on_event, &cancel).await,
        "openai" => stream_openai(&client, &args, &on_event, &cancel).await,
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
