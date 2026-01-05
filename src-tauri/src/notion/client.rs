//! Notion REST API 클라이언트
//!
//! Notion API를 직접 호출하여 페이지 검색, 조회 등을 수행합니다.

use crate::notion::types::*;
use keyring::Entry;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::RwLock;

const NOTION_API_BASE: &str = "https://api.notion.com/v1";
const NOTION_VERSION: &str = "2022-06-28";
const KEYCHAIN_SERVICE: &str = "com.ite.app";
const KEYCHAIN_NOTION_TOKEN: &str = "notion:integration_token";

/// 전역 Notion 클라이언트
pub static NOTION_CLIENT: Lazy<NotionClient> = Lazy::new(NotionClient::new);

/// Notion REST API 클라이언트
pub struct NotionClient {
    /// Integration Token (캐시)
    token: Arc<RwLock<Option<String>>>,
    /// HTTP 클라이언트
    http: reqwest::Client,
}

impl NotionClient {
    pub fn new() -> Self {
        Self {
            token: Arc::new(RwLock::new(None)),
            http: reqwest::Client::new(),
        }
    }

    /// 토큰 저장 (메모리 + 키체인)
    pub async fn set_token(&self, token: String) -> Result<(), String> {
        if token.is_empty() {
            return Err("Token cannot be empty".to_string());
        }

        // 토큰 형식 검증
        if !token.starts_with("ntn_") && !token.starts_with("secret_") {
            return Err("Invalid token format. Token should start with 'ntn_' or 'secret_'".to_string());
        }

        // 키체인에 저장
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_NOTION_TOKEN)
            .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
        entry
            .set_password(&token)
            .map_err(|e| format!("Failed to save token to keychain: {}", e))?;

        // 메모리 캐시 업데이트
        *self.token.write().await = Some(token);

        println!("[Notion] Token saved to keychain");
        Ok(())
    }

    /// 토큰 로드 (키체인에서)
    async fn load_token(&self) -> Option<String> {
        // 먼저 캐시 확인
        if let Some(token) = self.token.read().await.clone() {
            return Some(token);
        }

        // 키체인에서 로드
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_NOTION_TOKEN).ok()?;
        match entry.get_password() {
            Ok(token) => {
                *self.token.write().await = Some(token.clone());
                Some(token)
            }
            Err(keyring::Error::NoEntry) => None,
            Err(e) => {
                eprintln!("[Notion] Failed to load token from keychain: {}", e);
                None
            }
        }
    }

    /// 토큰 존재 여부 확인
    pub async fn has_token(&self) -> bool {
        self.load_token().await.is_some()
    }

    /// 토큰 삭제 (로그아웃)
    pub async fn clear_token(&self) {
        *self.token.write().await = None;

        if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_NOTION_TOKEN) {
            let _ = entry.delete_password();
        }

        println!("[Notion] Token cleared");
    }

    /// API 요청 공통 헤더 설정
    fn build_request(&self, token: &str) -> reqwest::RequestBuilder {
        self.http
            .get("") // placeholder, will be overwritten
            .header("Authorization", format!("Bearer {}", token))
            .header("Notion-Version", NOTION_VERSION)
            .header("Content-Type", "application/json")
    }

    /// 검색 API 호출
    pub async fn search(
        &self,
        query: Option<String>,
        filter: Option<String>,
        page_size: Option<u32>,
    ) -> Result<SearchResponse, String> {
        let token = self
            .load_token()
            .await
            .ok_or("No Notion token. Please set your Integration Token first.")?;

        let url = format!("{}/search", NOTION_API_BASE);

        let search_filter = filter.map(|f| match f.as_str() {
            "page" => SearchFilter::page(),
            "database" => SearchFilter::database(),
            _ => SearchFilter::page(),
        });

        let request_body = SearchRequest {
            query,
            filter: search_filter,
            start_cursor: None,
            page_size: page_size.or(Some(20)),
        };

        println!("[Notion] Searching: {:?}", request_body);

        let response = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Notion-Version", NOTION_VERSION)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<NotionError>(&body) {
                return Err(format!("Notion API error: {} ({})", error.message, error.code));
            }
            return Err(format!("Request failed with status {}: {}", status, body));
        }

        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} - {}", e, body))
    }

    /// 페이지 조회 API 호출
    pub async fn get_page(&self, page_id: &str) -> Result<Page, String> {
        let token = self
            .load_token()
            .await
            .ok_or("No Notion token. Please set your Integration Token first.")?;

        let id = Self::normalize_id(page_id);
        let url = format!("{}/pages/{}", NOTION_API_BASE, id);

        println!("[Notion] Getting page: {}", id);

        let response = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Notion-Version", NOTION_VERSION)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<NotionError>(&body) {
                return Err(format!("Notion API error: {} ({})", error.message, error.code));
            }
            return Err(format!("Request failed with status {}: {}", status, body));
        }

        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} - {}", e, body))
    }

    /// 페이지 블록(내용) 조회 API 호출
    pub async fn get_blocks(&self, block_id: &str, page_size: Option<u32>) -> Result<BlocksResponse, String> {
        let token = self
            .load_token()
            .await
            .ok_or("No Notion token. Please set your Integration Token first.")?;

        let id = Self::normalize_id(block_id);
        let url = format!("{}/blocks/{}/children?page_size={}", NOTION_API_BASE, id, page_size.unwrap_or(100));

        println!("[Notion] Getting blocks: {}", id);

        let response = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Notion-Version", NOTION_VERSION)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<NotionError>(&body) {
                return Err(format!("Notion API error: {} ({})", error.message, error.code));
            }
            return Err(format!("Request failed with status {}: {}", status, body));
        }

        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} - {}", e, body))
    }

    /// 데이터베이스 쿼리 API 호출
    pub async fn query_database(
        &self,
        database_id: &str,
        filter: Option<serde_json::Value>,
        page_size: Option<u32>,
    ) -> Result<DatabaseQueryResponse, String> {
        let token = self
            .load_token()
            .await
            .ok_or("No Notion token. Please set your Integration Token first.")?;

        let id = Self::normalize_id(database_id);
        let url = format!("{}/databases/{}/query", NOTION_API_BASE, id);

        let request_body = DatabaseQueryRequest {
            filter,
            sorts: None,
            start_cursor: None,
            page_size: page_size.or(Some(20)),
        };

        println!("[Notion] Querying database: {}", id);

        let response = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Notion-Version", NOTION_VERSION)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        if !status.is_success() {
            if let Ok(error) = serde_json::from_str::<NotionError>(&body) {
                return Err(format!("Notion API error: {} ({})", error.message, error.code));
            }
            return Err(format!("Request failed with status {}: {}", status, body));
        }

        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} - {}", e, body))
    }

    /// ID 정규화 (URL에서 추출, 하이픈 제거 등)
    fn normalize_id(id_or_url: &str) -> String {
        let id = if id_or_url.contains("notion.so") || id_or_url.contains("notion.site") {
            // URL에서 ID 추출
            // 예: https://www.notion.so/Page-Title-1234567890abcdef1234567890abcdef
            // 예: https://www.notion.so/1234567890abcdef1234567890abcdef
            id_or_url
                .split('/')
                .last()
                .unwrap_or(id_or_url)
                .split('-')
                .last()
                .unwrap_or(id_or_url)
                .split('?')
                .next()
                .unwrap_or(id_or_url)
                .to_string()
        } else {
            id_or_url.to_string()
        };

        // 하이픈 제거
        id.replace('-', "")
    }

    /// 블록을 텍스트로 변환
    pub fn blocks_to_text(blocks: &[Block]) -> String {
        blocks
            .iter()
            .filter_map(|block| Self::block_to_text(block))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// 단일 블록을 텍스트로 변환
    fn block_to_text(block: &Block) -> Option<String> {
        let content = &block.content;

        // 블록 타입별 텍스트 추출
        let text = match block.block_type.as_str() {
            "paragraph" => Self::extract_rich_text(content.get("paragraph")?),
            "heading_1" => format!("# {}", Self::extract_rich_text(content.get("heading_1")?)),
            "heading_2" => format!("## {}", Self::extract_rich_text(content.get("heading_2")?)),
            "heading_3" => format!("### {}", Self::extract_rich_text(content.get("heading_3")?)),
            "bulleted_list_item" => format!("• {}", Self::extract_rich_text(content.get("bulleted_list_item")?)),
            "numbered_list_item" => format!("1. {}", Self::extract_rich_text(content.get("numbered_list_item")?)),
            "to_do" => {
                let checked = content.get("to_do")?.get("checked")?.as_bool().unwrap_or(false);
                let checkbox = if checked { "[x]" } else { "[ ]" };
                format!("{} {}", checkbox, Self::extract_rich_text(content.get("to_do")?))
            }
            "toggle" => format!("> {}", Self::extract_rich_text(content.get("toggle")?)),
            "quote" => format!("> {}", Self::extract_rich_text(content.get("quote")?)),
            "callout" => Self::extract_rich_text(content.get("callout")?),
            "code" => {
                let code_text = Self::extract_rich_text(content.get("code")?);
                let language = content.get("code")?.get("language")?.as_str().unwrap_or("");
                format!("```{}\n{}\n```", language, code_text)
            }
            "divider" => "---".to_string(),
            _ => return None,
        };

        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    /// Rich text 배열에서 plain text 추출
    fn extract_rich_text(block_content: &serde_json::Value) -> String {
        block_content
            .get("rich_text")
            .and_then(|rt| rt.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("plain_text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default()
    }
}

impl Default for NotionClient {
    fn default() -> Self {
        Self::new()
    }
}

