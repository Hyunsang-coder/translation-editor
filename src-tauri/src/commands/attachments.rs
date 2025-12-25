use serde::Deserialize;
use tauri::State;
use uuid::Uuid;
use std::path::Path;
use std::fs;

use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::models::{Attachment, AttachmentDto};

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
    let path = Path::new(&args.path);
    if !path.exists() {
        return Err(CommandError {
            code: "FILE_NOT_FOUND".to_string(),
            message: format!("File not found: {}", args.path),
            details: None,
        });
    }

    let filename = path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    let extension = path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    let file_size = fs::metadata(path).map(|m| m.len() as i64).ok();
    
    // Extract text based on file type
    let extracted_text = extract_file_text(path, &extension).map_err(|e| CommandError {
        code: "EXTRACT_ERROR".to_string(),
        message: format!("Failed to extract text: {}", e),
        details: None,
    })?;

    let now = chrono::Utc::now().timestamp_millis();
    let attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        project_id: args.project_id.clone(),
        filename: filename.clone(),
        file_type: extension.clone(),
        file_path: Some(args.path.clone()),
        extracted_text: Some(extracted_text),
        file_size,
        created_at: now,
        updated_at: now,
    };

    let db = db_state.0.lock().map_err(|_| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: "Failed to acquire database lock".to_string(),
        details: None,
    })?;

    db.save_attachment(&attachment).map_err(CommandError::from)?;

    Ok(AttachmentDto {
        id: attachment.id,
        filename: attachment.filename,
        file_type: attachment.file_type,
        file_size: attachment.file_size,
        extracted_text: attachment.extracted_text,
        created_at: attachment.created_at,
        updated_at: attachment.updated_at,
    })
}

#[tauri::command]
pub fn list_attachments(
    project_id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<AttachmentDto>> {
    let db = db_state.0.lock().map_err(|_| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: "Failed to acquire database lock".to_string(),
        details: None,
    })?;

    let attachments = db.list_attachments(&project_id).map_err(CommandError::from)?;
    
    Ok(attachments.into_iter().map(|a| AttachmentDto {
        id: a.id,
        filename: a.filename,
        file_type: a.file_type,
        file_size: a.file_size,
        extracted_text: a.extracted_text,
        created_at: a.created_at,
        updated_at: a.updated_at,
    }).collect())
}

#[tauri::command]
pub fn delete_attachment(
    id: String,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    let db = db_state.0.lock().map_err(|_| CommandError {
        code: "LOCK_ERROR".to_string(),
        message: "Failed to acquire database lock".to_string(),
        details: None,
    })?;

    db.delete_attachment(&id).map_err(CommandError::from)?;
    Ok(())
}

fn extract_file_text(path: &Path, extension: &str) -> Result<String, String> {
    match extension {
        "md" | "txt" => {
            fs::read_to_string(path).map_err(|e| e.to_string())
        },
        "pdf" => {
            pdf_extract::extract_text(path).map_err(|e| e.to_string())
        },
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
                    },
                    _ => {}
                }
            }
            Ok(text)
        },
        "pptx" => {
            extract_pptx_text(path)
        },
        _ => Err(format!("Unsupported file type: {}", extension)),
    }
}

fn extract_pptx_text(path: &Path) -> Result<String, String> {
    use std::io::Read;
    use quick_xml::reader::Reader;
    use quick_xml::events::Event;

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
        slide_file.read_to_string(&mut content).map_err(|e| e.to_string())?;

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
            all_text.push_str(&format!("[Slide {}]\n{}\n\n", slide_index, slide_text.trim()));
        }

        slide_index += 1;
    }

    if all_text.is_empty() {
        Ok("No text content found in PPTX".to_string())
    } else {
        Ok(all_text)
    }
}
