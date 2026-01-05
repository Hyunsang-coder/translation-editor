//! Notion REST API Tauri 명령어
//!
//! Notion 검색, 페이지 조회 등의 기능을 프론트엔드에 노출합니다.

use crate::notion::NOTION_CLIENT;

/// Notion Integration Token 저장
#[tauri::command]
pub async fn notion_set_token(token: String) -> Result<(), String> {
    NOTION_CLIENT.set_token(token).await
}

/// Notion 토큰 존재 여부 확인
#[tauri::command]
pub async fn notion_has_token() -> Result<bool, String> {
    Ok(NOTION_CLIENT.has_token().await)
}

/// Notion 토큰 삭제 (로그아웃)
#[tauri::command]
pub async fn notion_clear_token() -> Result<(), String> {
    NOTION_CLIENT.clear_token().await;
    Ok(())
}

/// Notion 검색
/// 
/// # Arguments
/// * `query` - 검색어 (선택)
/// * `filter` - 필터: "page" 또는 "database" (선택)
/// * `page_size` - 결과 개수 (선택, 기본값 20)
#[tauri::command]
pub async fn notion_search(
    query: Option<String>,
    filter: Option<String>,
    page_size: Option<u32>,
) -> Result<String, String> {
    let result = NOTION_CLIENT.search(query, filter, page_size).await?;
    serde_json::to_string(&result).map_err(|e| format!("Failed to serialize result: {}", e))
}

/// Notion 페이지 조회
/// 
/// # Arguments
/// * `page_id` - 페이지 ID 또는 URL
#[tauri::command]
pub async fn notion_get_page(page_id: String) -> Result<String, String> {
    let result = NOTION_CLIENT.get_page(&page_id).await?;
    serde_json::to_string(&result).map_err(|e| format!("Failed to serialize result: {}", e))
}

/// Notion 페이지 내용(블록) 조회
/// 
/// # Arguments
/// * `page_id` - 페이지 ID 또는 URL
/// * `as_text` - true면 텍스트로 변환, false면 JSON
#[tauri::command]
pub async fn notion_get_page_content(
    page_id: String,
    as_text: Option<bool>,
) -> Result<String, String> {
    let result = NOTION_CLIENT.get_blocks(&page_id, None).await?;
    
    if as_text.unwrap_or(true) {
        // 블록을 읽기 쉬운 텍스트로 변환
        let text = crate::notion::NotionClient::blocks_to_text(&result.results);
        Ok(text)
    } else {
        serde_json::to_string(&result).map_err(|e| format!("Failed to serialize result: {}", e))
    }
}

/// Notion 데이터베이스 쿼리
/// 
/// # Arguments
/// * `database_id` - 데이터베이스 ID 또는 URL
/// * `filter` - 필터 JSON (선택)
/// * `page_size` - 결과 개수 (선택, 기본값 20)
#[tauri::command]
pub async fn notion_query_database(
    database_id: String,
    filter: Option<String>,
    page_size: Option<u32>,
) -> Result<String, String> {
    let filter_value = filter
        .map(|f| serde_json::from_str(&f))
        .transpose()
        .map_err(|e| format!("Invalid filter JSON: {}", e))?;
    
    let result = NOTION_CLIENT
        .query_database(&database_id, filter_value, page_size)
        .await?;
    
    serde_json::to_string(&result).map_err(|e| format!("Failed to serialize result: {}", e))
}

