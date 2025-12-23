//! ITE Data Models
//!
//! TypeScript 타입과 매핑되는 Rust 데이터 모델

use serde::{Deserialize, Serialize};

/// 프로젝트 전체 구조
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IteProject {
    pub id: String,
    pub version: String,
    pub metadata: ProjectMetadata,
    pub segments: Vec<SegmentGroup>,
    pub blocks: std::collections::HashMap<String, EditorBlock>,
    pub history: Vec<HistorySnapshot>,
}

/// 프로젝트 메타데이터
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub title: String,
    pub description: Option<String>,
    pub domain: String,
    #[serde(rename = "targetLanguage")]
    pub target_language: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub author: Option<String>,
    #[serde(rename = "glossaryPaths")]
    pub glossary_paths: Option<Vec<String>>,
    pub settings: ProjectSettings,
}

/// 프로젝트 설정
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSettings {
    #[serde(rename = "strictnessLevel")]
    pub strictness_level: f64,
    #[serde(rename = "autoSave")]
    pub auto_save: bool,
    #[serde(rename = "autoSaveInterval")]
    pub auto_save_interval: u64,
    pub theme: String,
}

/// 원문-번역문 연결 그룹 (N:M 매핑)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentGroup {
    #[serde(rename = "groupId")]
    pub group_id: String,
    #[serde(rename = "sourceIds")]
    pub source_ids: Vec<String>,
    #[serde(rename = "targetIds")]
    pub target_ids: Vec<String>,
    #[serde(rename = "isAligned")]
    pub is_aligned: bool,
    pub order: i32,
}

/// 개별 블록 데이터
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub content: String,
    pub hash: String,
    pub metadata: BlockMetadata,
}

/// 블록 메타데이터
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockMetadata {
    pub author: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub tags: Vec<String>,
    pub comments: Option<Vec<BlockComment>>,
}

/// 블록 코멘트
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockComment {
    pub id: String,
    pub author: String,
    pub content: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    pub resolved: bool,
}

/// 히스토리 스냅샷
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistorySnapshot {
    pub id: String,
    pub timestamp: i64,
    pub description: String,
    #[serde(rename = "blockChanges")]
    pub block_changes: Vec<BlockChange>,
    #[serde(rename = "chatSummary")]
    pub chat_summary: Option<String>,
}

/// 블록 변경 기록
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockChange {
    #[serde(rename = "blockId")]
    pub block_id: String,
    #[serde(rename = "previousContent")]
    pub previous_content: String,
    #[serde(rename = "newContent")]
    pub new_content: String,
    #[serde(rename = "type")]
    pub change_type: String,
}

/// 채팅 세션
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    pub messages: Vec<ChatMessage>,
    #[serde(rename = "contextBlockIds")]
    pub context_block_ids: Vec<String>,
}

/// 채팅 메시지
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub metadata: Option<ChatMessageMetadata>,
}

/// 채팅 메시지 메타데이터
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageMetadata {
    pub model: Option<String>,
    pub tokens: Option<u32>,
    #[serde(rename = "suggestedBlockId")]
    pub suggested_block_id: Option<String>,
    #[serde(rename = "appliedAt")]
    pub applied_at: Option<i64>,
    pub accepted: Option<bool>,
}

