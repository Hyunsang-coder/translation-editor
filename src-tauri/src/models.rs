//! ITE Data Models
//!
//! TypeScript 타입과 매핑되는 Rust 데이터 모델

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    /// 메시지 메타데이터는 프론트(TypeScript) 구조를 그대로 roundtrip 하기 위해 JSON으로 보관합니다.
    /// (버튼 상태, suggestion 등 UX 메타데이터 유실 방지)
    pub metadata: Option<Value>,
}

// NOTE: 과거에는 ChatMessageMetadata를 Rust struct로 고정했지만,
// TS 메타데이터가 확장되면서 유실 위험이 커져 JSON(Value)로 변경했습니다.

