//! Notion API 응답 타입 정의

use serde::{Deserialize, Serialize};

/// 검색 API 응답
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

/// 검색 결과 항목
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub object: String, // "page" or "database"
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub created_time: Option<String>,
    #[serde(default)]
    pub last_edited_time: Option<String>,
    #[serde(default)]
    pub properties: Option<serde_json::Value>,
    #[serde(default)]
    pub title: Option<Vec<RichText>>,
    #[serde(default)]
    pub parent: Option<Parent>,
}

/// 페이지 객체
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub object: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub created_time: Option<String>,
    #[serde(default)]
    pub last_edited_time: Option<String>,
    #[serde(default)]
    pub properties: serde_json::Value,
    #[serde(default)]
    pub parent: Option<Parent>,
}

/// 블록 목록 응답
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlocksResponse {
    pub results: Vec<Block>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

/// 블록 객체
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub object: String,
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub has_children: bool,
    /// 블록 타입별 내용 (paragraph, heading_1, bulleted_list_item 등)
    #[serde(flatten)]
    pub content: serde_json::Value,
}

/// 데이터베이스 쿼리 응답
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseQueryResponse {
    pub results: Vec<Page>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

/// 부모 객체
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parent {
    #[serde(rename = "type")]
    pub parent_type: String,
    #[serde(default)]
    pub page_id: Option<String>,
    #[serde(default)]
    pub database_id: Option<String>,
    #[serde(default)]
    pub workspace: Option<bool>,
}

/// Rich Text 객체
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RichText {
    #[serde(rename = "type")]
    pub text_type: String,
    #[serde(default)]
    pub plain_text: Option<String>,
    #[serde(default)]
    pub text: Option<TextContent>,
    #[serde(default)]
    pub annotations: Option<Annotations>,
}

/// 텍스트 내용
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextContent {
    pub content: String,
    #[serde(default)]
    pub link: Option<Link>,
}

/// 링크
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub url: String,
}

/// 텍스트 스타일
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotations {
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub strikethrough: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub code: bool,
}

/// 검색 필터
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilter {
    pub value: String, // "page" or "database"
    pub property: String, // always "object"
}

impl SearchFilter {
    pub fn page() -> Self {
        Self {
            value: "page".to_string(),
            property: "object".to_string(),
        }
    }

    pub fn database() -> Self {
        Self {
            value: "database".to_string(),
            property: "object".to_string(),
        }
    }
}

/// 검색 요청
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<SearchFilter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
}

/// 데이터베이스 쿼리 요청
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseQueryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sorts: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
}

/// Notion API 에러 응답
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionError {
    pub object: String,
    pub status: u16,
    pub code: String,
    pub message: String,
}

