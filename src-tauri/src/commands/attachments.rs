use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use std::fs;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

use super::{run_db_task, AcquireDb};
use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::{Attachment, AttachmentDto};
use crate::utils::{validate_file_size, validate_path};

/// 이미지 첨부 파일 최대 크기 (100MB)
const MAX_IMAGE_ATTACHMENT_SIZE: u64 = 100 * 1024 * 1024;

/// 문서 첨부 파일 최대 크기 (200MB) — 텍스트만 추출
const MAX_DOCUMENT_ATTACHMENT_SIZE: u64 = 200 * 1024 * 1024;

/// 임시 이미지 최대 크기 (10MB)
const MAX_TEMP_IMAGE_SIZE: usize = 10 * 1024 * 1024;

/// 임시 파일 만료 시간 (24시간)
const TEMP_FILE_MAX_AGE_SECS: u64 = 24 * 60 * 60;

fn is_image_extension(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachFileArgs {
    pub project_id: String,
    pub path: String,
}

#[tauri::command]
pub async fn attach_file(
    args: AttachFileArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<AttachmentDto> {
    // utils::validate_path (Blocklist 적용)
    let path = validate_path(&args.path)?;

    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    // 파일 크기 제한: 이미지 100MB / 문서(pdf, docx, pptx 등) 200MB
    let max_size = if is_image_extension(&extension) {
        MAX_IMAGE_ATTACHMENT_SIZE
    } else {
        MAX_DOCUMENT_ATTACHMENT_SIZE
    };
    let file_size = validate_file_size(&path, max_size)? as i64;

    // Extract text based on file type (images are stored without extracted text)
    let extracted_text: Option<String> = if is_image_extension(&extension) {
        None
    } else {
        Some(
            extract_file_text(&path, &extension).map_err(|e| CommandError {
                code: "EXTRACT_ERROR".to_string(),
                message: format!("Failed to extract text: {}", e),
                details: None,
            })?,
        )
    };

    let now = chrono::Utc::now().timestamp_millis();
    let attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        project_id: args.project_id.clone(),
        filename: filename.clone(),
        file_type: extension.clone(),
        file_path: Some(path.to_string_lossy().to_string()),
        extracted_text,
        file_size: Some(file_size),
        created_at: now,
        updated_at: now,
    };

    let db = db_state.acquire()?;

    db.save_attachment(&attachment)
        .map_err(CommandError::from)?;

    let extracted_text_length = attachment.extracted_text.as_ref().map(|t| t.len() as i64);
    Ok(AttachmentDto {
        id: attachment.id,
        filename: attachment.filename,
        file_type: attachment.file_type,
        file_size: attachment.file_size,
        extracted_text: attachment.extracted_text,
        extracted_text_length,
        file_path: attachment.file_path,
        created_at: attachment.created_at,
        updated_at: attachment.updated_at,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileBytesArgs {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAttachmentArgs {
    pub path: String,
}

/// 파일을 DB에 저장하지 않고 "미리보기 DTO"로만 반환합니다.
/// - 채팅 컴포저 전용 첨부(일회성)에서 사용합니다.
/// - 프로젝트(Settings) 첨부 목록과 섞이지 않도록 DB를 건드리지 않습니다.
#[tauri::command]
pub async fn preview_attachment(args: PreviewAttachmentArgs) -> CommandResult<AttachmentDto> {
    // utils::validate_path (Blocklist 적용)
    let path = validate_path(&args.path)?;

    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    // 파일 크기 제한: 이미지는 100MB, 문서는 2GB
    let max_size = if is_image_extension(&extension) {
        MAX_IMAGE_ATTACHMENT_SIZE
    } else {
        MAX_DOCUMENT_ATTACHMENT_SIZE
    };
    let file_size = validate_file_size(&path, max_size)? as i64;

    let extracted_text = extract_file_text(&path, &extension).ok();
    let extracted_text_length = extracted_text.as_ref().map(|t| t.len() as i64);

    let now = chrono::Utc::now().timestamp_millis();
    Ok(AttachmentDto {
        id: Uuid::new_v4().to_string(),
        filename,
        file_type: extension,
        file_size: Some(file_size),
        extracted_text,
        extracted_text_length,
        file_path: Some(path.to_string_lossy().to_string()),
        created_at: now,
        updated_at: now,
    })
}

/// 로컬 파일을 base64 문자열로 읽습니다.
/// - 이미지 멀티모달(vision) 입력용. number[] JSON 직렬화(5MB 이미지 → ~20MB JSON)
///   비용을 피하기 위해 base64 문자열 하나로 반환합니다. (P5)
/// - 파일이 사라졌거나 접근 불가하면 에러를 반환합니다.
#[tauri::command]
pub async fn read_file_bytes(args: ReadFileBytesArgs) -> CommandResult<String> {
    // utils::validate_path (Blocklist 적용)
    let path = validate_path(&args.path)?;

    // 파일 크기 검증 (이미지 100MB 제한)
    validate_file_size(&path, MAX_IMAGE_ATTACHMENT_SIZE)?;

    let bytes = fs::read(&path).map_err(|e| CommandError {
        code: "READ_ERROR".to_string(),
        message: format!("Failed to read file: {}", e),
        details: None,
    })?;

    Ok(BASE64.encode(bytes))
}

// async + run_db_task(spawn_blocking): DB 접근이 async 런타임 워커를 점유하지 않도록
// blocking 스레드풀에서 실행 (C1 연관). 다른 DB 커맨드(block.rs 등)와 동일 패턴.
#[tauri::command]
pub async fn list_attachments(
    project_id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<AttachmentDto>> {
    run_db_task(&db_state, move |db| {
        let attachments = db.list_attachments(&project_id).map_err(CommandError::from)?;

        Ok(attachments
            .into_iter()
            .map(|a| {
                let extracted_text_length = a.extracted_text.as_ref().map(|t| t.len() as i64);
                AttachmentDto {
                    id: a.id,
                    filename: a.filename,
                    file_type: a.file_type,
                    file_size: a.file_size,
                    extracted_text: a.extracted_text,
                    extracted_text_length,
                    file_path: a.file_path,
                    created_at: a.created_at,
                    updated_at: a.updated_at,
                }
            })
            .collect())
    })
    .await
}

// async + run_db_task(spawn_blocking): 위와 동일 이유로 blocking 스레드풀에서 실행 (C1 연관).
#[tauri::command]
pub async fn delete_attachment(id: String, db_state: State<'_, DbState>) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.delete_attachment(&id).map_err(CommandError::from)?;
        Ok(())
    })
    .await
}

fn extract_file_text(path: &Path, extension: &str) -> Result<String, String> {
    match extension {
        "md" | "txt" => fs::read_to_string(path).map_err(|e| e.to_string()),
        // 이미지 파일은 텍스트 추출 대신 "첨부 허용"만 하고, 멀티모달(vision) 입력은 프론트에서 처리합니다.
        "png" | "jpg" | "jpeg" | "webp" | "gif" => Ok(String::new()),
        "pdf" => pdf_extract::extract_text(path).map_err(|e| e.to_string()),
        "docx" => {
            let buf = fs::read(path).map_err(|e| e.to_string())?;
            let docx = docx_rs::read_docx(&buf).map_err(|e| e.to_string())?;

            let mut text = String::new();
            for child in docx.document.children {
                match child {
                    docx_rs::DocumentChild::Paragraph(p) => {
                        for child in p.children {
                            if let docx_rs::ParagraphChild::Run(r) = child {
                                for child in r.children {
                                    if let docx_rs::RunChild::Text(t) = child {
                                        text.push_str(&t.text);
                                    }
                                }
                            }
                        }
                        text.push('\n');
                    }
                    _ => {}
                }
            }
            Ok(text)
        }
        "pptx" => extract_pptx_text(path),
        _ => Err(format!("Unsupported file type: {}", extension)),
    }
}

fn extract_pptx_text(path: &Path) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    use std::io::Read;

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut all_text = String::new();

    // Iterate through slide files: ppt/slides/slideN.xml
    let mut slide_index = 1;
    loop {
        let slide_filename = format!("ppt/slides/slide{}.xml", slide_index);
        let mut slide_file = match archive.by_name(&slide_filename) {
            Ok(f) => f,
            Err(_) => break, // No more slides
        };

        let mut content = String::new();
        slide_file
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;

        let mut reader = Reader::from_str(&content);
        let mut buf = Vec::new();
        let mut slide_text = String::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Text(e)) => {
                    slide_text.push_str(&e.unescape().unwrap_or_default());
                    slide_text.push(' ');
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(e.to_string()),
                _ => {}
            }
            buf.clear();
        }

        if !slide_text.trim().is_empty() {
            all_text.push_str(&format!(
                "[Slide {}]\n{}\n\n",
                slide_index,
                slide_text.trim()
            ));
        }

        slide_index += 1;
    }

    if all_text.is_empty() {
        Ok("No text content found in PPTX".to_string())
    } else {
        Ok(all_text)
    }
}

/// 이미지 바이트를 임시 파일로 저장하고 경로를 반환합니다.
/// - 드래그앤드롭 또는 클립보드에서 이미지를 붙여넣을 때 사용합니다.
/// - 프론트엔드에서 File/Blob을 base64 문자열로 변환하여 전송합니다.
///   (number[] JSON 직렬화로 인한 UI 프리즈 방지, P5)
#[tauri::command]
pub async fn save_temp_image(bytes_base64: String, filename: String) -> CommandResult<String> {
    // base64 길이 기준 사전 검증 (대용량 디코딩 방지, base64는 원본의 약 4/3 크기)
    if bytes_base64.len() > MAX_TEMP_IMAGE_SIZE / 3 * 4 + 4 {
        return Err(CommandError {
            code: "FILE_TOO_LARGE".to_string(),
            message: format!(
                "이미지 크기가 너무 큽니다: {}MB (최대 10MB)",
                bytes_base64.len() / 4 * 3 / (1024 * 1024)
            ),
            details: None,
        });
    }

    let bytes = BASE64
        .decode(bytes_base64.as_bytes())
        .map_err(|e| CommandError {
            code: "INVALID_BASE64".to_string(),
            message: format!("이미지 데이터 디코딩 실패: {}", e),
            details: None,
        })?;

    // 이미지 크기 검증 (10MB 제한)
    if bytes.len() > MAX_TEMP_IMAGE_SIZE {
        return Err(CommandError {
            code: "FILE_TOO_LARGE".to_string(),
            message: format!(
                "이미지 크기가 너무 큽니다: {}MB (최대 10MB)",
                bytes.len() / (1024 * 1024)
            ),
            details: None,
        });
    }

    // 파일 확장자 검증 (이미지만 허용)
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    if !is_image_extension(&extension) {
        return Err(CommandError {
            code: "INVALID_TYPE".to_string(),
            message: format!("지원하지 않는 이미지 형식입니다: {}", extension),
            details: None,
        });
    }

    // 임시 디렉토리 생성
    let temp_dir = std::env::temp_dir().join("oddeyes-uploads");
    fs::create_dir_all(&temp_dir).map_err(|e| CommandError {
        code: "DIR_CREATE_ERROR".to_string(),
        message: format!("임시 디렉토리 생성 실패: {}", e),
        details: None,
    })?;

    // 파일명에서 경로 탐색 문자 제거 (../../ 등 방지)
    let safe_filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image");

    // 고유한 파일명 생성
    let unique_name = format!("{}_{}", Uuid::new_v4(), safe_filename);
    let path = temp_dir.join(&unique_name);

    // 파일 저장
    fs::write(&path, bytes).map_err(|e| CommandError {
        code: "WRITE_ERROR".to_string(),
        message: format!("파일 저장 실패: {}", e),
        details: None,
    })?;

    Ok(path.to_string_lossy().to_string())
}

/// 오래된 임시 이미지 파일을 정리합니다.
/// - 앱 시작 시 호출하여 24시간 이상 된 임시 파일을 삭제합니다.
// async: 디렉토리 순회/삭제가 메인 스레드를 점유하지 않도록 스레드풀에서 실행 (C1 연관)
#[tauri::command]
pub async fn cleanup_temp_images() -> CommandResult<u32> {
    let temp_dir = std::env::temp_dir().join("oddeyes-uploads");

    if !temp_dir.exists() {
        return Ok(0);
    }

    let now = std::time::SystemTime::now();
    let mut deleted_count: u32 = 0;

    let entries = fs::read_dir(&temp_dir).map_err(|e| CommandError {
        code: "READ_DIR_ERROR".to_string(),
        message: format!("임시 디렉토리 읽기 실패: {}", e),
        details: None,
    })?;

    for entry in entries.flatten() {
        let path = entry.path();

        // 파일만 처리
        if !path.is_file() {
            continue;
        }

        // 파일 수정 시간 확인
        if let Ok(metadata) = fs::metadata(&path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(age) = now.duration_since(modified) {
                    if age.as_secs() > TEMP_FILE_MAX_AGE_SECS {
                        if fs::remove_file(&path).is_ok() {
                            deleted_count += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(deleted_count)
}
