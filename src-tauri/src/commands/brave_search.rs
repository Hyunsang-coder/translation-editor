//! Brave Search Commands
//!
//! Brave Search API 호출을 Rust(Tauri) 백엔드에서 수행합니다.
//! - 프론트엔드(WebView)에서 직접 호출하면 CORS(Preflight 405)로 막히므로 프록시가 필요합니다.

use serde::{Deserialize, Serialize};

use crate::error::{CommandError, CommandResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BraveSearchArgs {
    pub query: String,
    pub count: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BraveSearchResultDto {
    pub title: String,
    pub url: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BraveWebSearchResponse {
    web: Option<BraveWebSearchWeb>,
}

#[derive(Debug, Deserialize)]
struct BraveWebSearchWeb {
    results: Option<Vec<BraveWebSearchItem>>,
}

#[derive(Debug, Deserialize)]
struct BraveWebSearchItem {
    title: Option<String>,
    url: Option<String>,
    description: Option<String>,
}

fn get_brave_api_key() -> Result<String, CommandError> {
    // 우선순위: BRAVE_SEARCH_API > VITE_BRAVE_SEARCH_API
    if let Ok(v) = std::env::var("BRAVE_SEARCH_API") {
        if !v.trim().is_empty() {
            return Ok(v.trim().to_string());
        }
    }
    if let Ok(v) = std::env::var("VITE_BRAVE_SEARCH_API") {
        if !v.trim().is_empty() {
            return Ok(v.trim().to_string());
        }
    }

    Err(CommandError {
        code: "BRAVE_API_KEY_MISSING".to_string(),
        message: "Brave Search API key is missing. Please set BRAVE_SEARCH_API in .env.local".to_string(),
        details: None,
    })
}

/// Brave Web Search API 호출
#[tauri::command]
pub async fn brave_search(args: BraveSearchArgs) -> CommandResult<Vec<BraveSearchResultDto>> {
    let api_key = get_brave_api_key()?;
    let q = args.query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let count = args.count.unwrap_or(5).clamp(1, 10);

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .query(&[("q", q), ("count", &count.to_string())])
        .header("X-Subscription-Token", api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| CommandError {
            code: "BRAVE_REQUEST_FAILED".to_string(),
            message: format!("Brave Search request failed: {}", e),
            details: None,
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(CommandError {
            code: "BRAVE_HTTP_ERROR".to_string(),
            message: format!("Brave Search API error: {} {}", status.as_u16(), status),
            details: Some(body),
        });
    }

    let data: BraveWebSearchResponse = resp.json().await.map_err(|e| CommandError {
        code: "BRAVE_PARSE_ERROR".to_string(),
        message: format!("Failed to parse Brave Search response: {}", e),
        details: None,
    })?;

    let results = data
        .web
        .and_then(|w| w.results)
        .unwrap_or_default()
        .into_iter()
        .map(|r| BraveSearchResultDto {
            title: r.title.unwrap_or_default(),
            url: r.url.unwrap_or_default(),
            description: r.description,
        })
        .filter(|r| !r.title.trim().is_empty() && !r.url.trim().is_empty())
        .collect::<Vec<_>>();

    Ok(results)
}



