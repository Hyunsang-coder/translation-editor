//! Confluence REST API Commands
//!
//! MCP OAuth 토큰을 재사용하여 Confluence REST API 직접 호출.
//! 단어 카운팅 등 LLM 컨텍스트에 내용을 노출하지 않아야 하는 작업에 사용.

use crate::mcp::client::MCP_CLIENT;
use serde::{Deserialize, Serialize};

/// Confluence 페이지 콘텐츠 응답
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfluencePageContent {
    pub page_id: String,
    pub title: String,
    /// storage 포맷 (HTML)
    pub body: String,
}

/// Confluence REST API v2 페이지 응답 구조
#[derive(Debug, Deserialize)]
struct ConfluenceApiPageResponse {
    id: String,
    title: String,
    body: Option<ConfluenceApiBody>,
}

#[derive(Debug, Deserialize)]
struct ConfluenceApiBody {
    storage: Option<ConfluenceApiStorage>,
}

#[derive(Debug, Deserialize)]
struct ConfluenceApiStorage {
    value: String,
}

/// Accessible Resources 응답 구조
#[derive(Debug, Deserialize)]
struct AccessibleResource {
    id: String,
    url: String,
    name: String,
}

/// Confluence 페이지 HTML(storage format) 가져오기
///
/// MCP OAuth 토큰을 재사용하여 Confluence REST API v2 직접 호출.
/// 결과는 Tauri command로만 반환되어 LLM 컨텍스트에 노출되지 않음.
#[tauri::command]
pub async fn confluence_get_page_html(page_id: String) -> Result<ConfluencePageContent, String> {
    println!("[Confluence REST] Getting page HTML for: {}", page_id);

    // 1. OAuth 토큰 가져오기
    let access_token = MCP_CLIENT
        .get_oauth_token()
        .await
        .ok_or("Atlassian OAuth 토큰이 없습니다. Confluence에 먼저 연결해주세요.")?;

    println!("[Confluence REST] Got OAuth token (length: {})", access_token.len());

    // 2. cloudId 가져오기 (accessible resources에서)
    let cloud_id = match get_cloud_id(&access_token).await {
        Ok(id) => {
            println!("[Confluence REST] Got cloudId: {}", id);
            id
        }
        Err(e) => {
            println!("[Confluence REST] Failed to get cloudId: {}", e);
            return Err(e);
        }
    };

    // 3. Confluence REST API v2 호출
    // https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-get
    let url = format!(
        "https://api.atlassian.com/ex/confluence/{}/wiki/api/v2/pages/{}?body-format=storage",
        cloud_id, page_id
    );
    println!("[Confluence REST] Calling API: {}", url);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Confluence API 요청 실패: {}", e))?;

    let status = response.status();
    println!("[Confluence REST] Response status: {}", status);

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        println!("[Confluence REST] Error response: {}", body);
        return Err(format!(
            "Confluence API 오류 ({}): {}",
            status, body
        ));
    }

    let api_response: ConfluenceApiPageResponse = response
        .json()
        .await
        .map_err(|e| format!("Confluence API 응답 파싱 실패: {}", e))?;

    let body = api_response
        .body
        .and_then(|b| b.storage)
        .map(|s| s.value)
        .unwrap_or_default();

    println!("[Confluence REST] Success! Title: {}, Body length: {}", api_response.title, body.len());

    Ok(ConfluencePageContent {
        page_id: api_response.id,
        title: api_response.title,
        body,
    })
}

/// cloudId 가져오기 (캐시 없이 매번 조회 - 간단한 구현)
async fn get_cloud_id(access_token: &str) -> Result<String, String> {
    let url = "https://api.atlassian.com/oauth/token/accessible-resources";

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Accessible resources 요청 실패: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Accessible resources 오류 ({}): {}",
            status, body
        ));
    }

    let resources: Vec<AccessibleResource> = response
        .json()
        .await
        .map_err(|e| format!("Accessible resources 파싱 실패: {}", e))?;

    resources
        .first()
        .map(|r| r.id.clone())
        .ok_or_else(|| "Atlassian cloudId를 찾을 수 없습니다".to_string())
}
