//! PPTX Commands
//!
//! PPTX 파일에서 텍스트 추출 및 번역된 텍스트로 교체하는 커맨드

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use zip::read::ZipArchive;
use zip::write::ZipWriter;
use zip::CompressionMethod;

use crate::error::{CommandError, CommandResult};
use crate::utils::validate_path;

/// 슬라이드 내 텍스트 정보
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlideText {
    /// 슬라이드 인덱스 (0-based)
    pub slide_index: usize,
    /// 슬라이드 내 텍스트들 (순서 유지)
    pub texts: Vec<String>,
}

/// PPTX 추출 결과
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedPptx {
    /// 파일 이름
    pub file_name: String,
    /// 슬라이드별 텍스트
    pub slides: Vec<SlideText>,
}

/// PPTX 파일에서 슬라이드별 텍스트 추출
///
/// PPTX는 ZIP 아카이브이며, ppt/slides/slide*.xml 파일들에서 <a:t> 태그 내 텍스트를 추출합니다.
#[tauri::command]
pub async fn extract_pptx_texts(path: String) -> CommandResult<ExtractedPptx> {
    // 경로 검증
    let validated_path = validate_path(&path)?;

    // 파일명 추출
    let file_name = validated_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.pptx".to_string());

    // ZIP 아카이브 열기
    let file = File::open(&validated_path).map_err(|e| CommandError {
        code: "IO_ERROR".to_string(),
        message: format!("Failed to open PPTX file: {}", e),
        details: None,
    })?;

    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).map_err(|e| CommandError {
        code: "ZIP_ERROR".to_string(),
        message: format!("Failed to read PPTX as ZIP: {}", e),
        details: None,
    })?;

    // 슬라이드 파일 목록 수집 및 정렬
    let mut slide_files: Vec<(usize, String)> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name().to_string();
            // ppt/slides/slide*.xml 패턴 매칭
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                // 슬라이드 번호 추출 (slide1.xml -> 1)
                if let Some(num_str) = name
                    .strip_prefix("ppt/slides/slide")
                    .and_then(|s| s.strip_suffix(".xml"))
                {
                    if let Ok(num) = num_str.parse::<usize>() {
                        slide_files.push((num, name));
                    }
                }
            }
        }
    }

    // 슬라이드 번호 순으로 정렬
    slide_files.sort_by_key(|(num, _)| *num);

    // 각 슬라이드에서 텍스트 추출
    let mut slides: Vec<SlideText> = Vec::new();

    for (slide_num, slide_path) in slide_files {
        let mut slide_file = archive.by_name(&slide_path).map_err(|e| CommandError {
            code: "ZIP_ERROR".to_string(),
            message: format!("Failed to read slide {}: {}", slide_num, e),
            details: None,
        })?;

        let mut xml_content = String::new();
        slide_file
            .read_to_string(&mut xml_content)
            .map_err(|e| CommandError {
                code: "IO_ERROR".to_string(),
                message: format!("Failed to read slide {} content: {}", slide_num, e),
                details: None,
            })?;

        // XML에서 <a:t> 태그 텍스트 추출
        let texts = extract_texts_from_xml(&xml_content)?;

        slides.push(SlideText {
            slide_index: slide_num - 1, // 0-based index
            texts,
        });
    }

    Ok(ExtractedPptx { file_name, slides })
}

/// 번역된 텍스트로 새 PPTX 생성
///
/// 원본 PPTX를 복사하고, slide*.xml 파일의 <a:t> 태그 내용만 번역된 텍스트로 교체합니다.
/// 이미지, 테마, 레이아웃 등 다른 모든 요소는 그대로 유지됩니다.
#[tauri::command]
pub async fn write_translated_pptx(
    source_path: String,
    output_path: String,
    translations: Vec<SlideText>,
) -> CommandResult<()> {
    // 경로 검증
    let validated_source = validate_path(&source_path)?;
    let validated_output = validate_path(&output_path)?;

    // 번역 데이터를 HashMap으로 변환 (slide_index -> texts)
    let translations_map: HashMap<usize, Vec<String>> = translations
        .into_iter()
        .map(|st| (st.slide_index, st.texts))
        .collect();

    // 원본 ZIP 열기
    let source_file = File::open(&validated_source).map_err(|e| CommandError {
        code: "IO_ERROR".to_string(),
        message: format!("Failed to open source PPTX: {}", e),
        details: None,
    })?;

    let reader = BufReader::new(source_file);
    let mut source_archive = ZipArchive::new(reader).map_err(|e| CommandError {
        code: "ZIP_ERROR".to_string(),
        message: format!("Failed to read source PPTX as ZIP: {}", e),
        details: None,
    })?;

    // 출력 ZIP 생성
    let output_file = File::create(&validated_output).map_err(|e| CommandError {
        code: "IO_ERROR".to_string(),
        message: format!("Failed to create output PPTX: {}", e),
        details: None,
    })?;

    let mut output_archive = ZipWriter::new(output_file);

    // 모든 파일 복사, slide*.xml만 수정
    for i in 0..source_archive.len() {
        let mut source_entry = source_archive.by_index(i).map_err(|e| CommandError {
            code: "ZIP_ERROR".to_string(),
            message: format!("Failed to read ZIP entry: {}", e),
            details: None,
        })?;

        let entry_name = source_entry.name().to_string();

        // ZIP 엔트리 옵션 설정
        let options = zip::write::FileOptions::<()>::default()
            .compression_method(if source_entry.compression() == CompressionMethod::Stored {
                CompressionMethod::Stored
            } else {
                CompressionMethod::Deflated
            });

        // 디렉토리인 경우
        if entry_name.ends_with('/') {
            output_archive
                .add_directory(&entry_name, options)
                .map_err(|e| CommandError {
                    code: "ZIP_ERROR".to_string(),
                    message: format!("Failed to add directory: {}", e),
                    details: None,
                })?;
            continue;
        }

        // 슬라이드 XML 파일인지 확인
        let slide_index = if entry_name.starts_with("ppt/slides/slide") && entry_name.ends_with(".xml") {
            entry_name
                .strip_prefix("ppt/slides/slide")
                .and_then(|s| s.strip_suffix(".xml"))
                .and_then(|s| s.parse::<usize>().ok())
                .map(|n| n - 1) // 0-based index
        } else {
            None
        };

        // 파일 내용 읽기
        let mut content = Vec::new();
        source_entry.read_to_end(&mut content).map_err(|e| CommandError {
            code: "IO_ERROR".to_string(),
            message: format!("Failed to read entry content: {}", e),
            details: None,
        })?;

        // 슬라이드 XML이고 번역이 있으면 텍스트 교체
        let final_content = if let Some(idx) = slide_index {
            if let Some(translated_texts) = translations_map.get(&idx) {
                let xml_str = String::from_utf8_lossy(&content);
                let modified_xml = replace_texts_in_xml(&xml_str, translated_texts)?;
                modified_xml.into_bytes()
            } else {
                content
            }
        } else {
            content
        };

        // 출력 ZIP에 쓰기
        output_archive
            .start_file(&entry_name, options)
            .map_err(|e| CommandError {
                code: "ZIP_ERROR".to_string(),
                message: format!("Failed to start file in ZIP: {}", e),
                details: None,
            })?;

        output_archive.write_all(&final_content).map_err(|e| CommandError {
            code: "IO_ERROR".to_string(),
            message: format!("Failed to write file content: {}", e),
            details: None,
        })?;
    }

    // ZIP 완료
    output_archive.finish().map_err(|e| CommandError {
        code: "ZIP_ERROR".to_string(),
        message: format!("Failed to finalize ZIP: {}", e),
        details: None,
    })?;

    Ok(())
}

/// XML에서 <a:t> 태그의 텍스트 추출
fn extract_texts_from_xml(xml: &str) -> CommandResult<Vec<String>> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut texts: Vec<String> = Vec::new();
    let mut in_a_t = false;
    let mut current_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                // <a:t> 태그 시작
                if e.local_name().as_ref() == b"t" {
                    // namespace가 a: 인지 확인 (DrawingML)
                    let name_bytes = e.name().as_ref().to_vec();
                    let name = String::from_utf8_lossy(&name_bytes);
                    if name == "a:t" || name.ends_with(":t") {
                        in_a_t = true;
                        current_text.clear();
                    }
                }
            }
            Ok(Event::End(e)) => {
                // <a:t> 태그 종료
                let name_bytes = e.name().as_ref().to_vec();
                let name = String::from_utf8_lossy(&name_bytes);
                if (name == "a:t" || name.ends_with(":t")) && in_a_t {
                    in_a_t = false;
                    // 빈 텍스트도 위치 유지를 위해 포함 (번역 시 순서 매칭)
                    texts.push(current_text.clone());
                }
            }
            Ok(Event::Text(e)) => {
                if in_a_t {
                    current_text.push_str(&e.unescape().unwrap_or_default());
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML parsing error: {}", e),
                    details: None,
                });
            }
            _ => {}
        }
    }

    Ok(texts)
}

/// XML에서 <a:t> 태그의 텍스트를 순서대로 교체
fn replace_texts_in_xml(xml: &str, translations: &[String]) -> CommandResult<String> {
    use quick_xml::events::{BytesText, Event};
    use quick_xml::{Reader, Writer};

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut writer = Writer::new(Vec::new());
    let mut text_index = 0;
    let mut in_a_t = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name_bytes = e.name().as_ref().to_vec();
                let name = String::from_utf8_lossy(&name_bytes);
                if name == "a:t" || name.ends_with(":t") {
                    in_a_t = true;
                }
                writer.write_event(Event::Start(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::End(e)) => {
                let name_bytes = e.name().as_ref().to_vec();
                let name = String::from_utf8_lossy(&name_bytes);
                if (name == "a:t" || name.ends_with(":t")) && in_a_t {
                    in_a_t = false;
                    text_index += 1;
                }
                writer.write_event(Event::End(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::Text(e)) => {
                if in_a_t && text_index < translations.len() {
                    // 번역된 텍스트로 교체
                    let new_text = BytesText::new(&translations[text_index]);
                    writer.write_event(Event::Text(new_text)).map_err(|e| CommandError {
                        code: "XML_ERROR".to_string(),
                        message: format!("XML write error: {}", e),
                        details: None,
                    })?;
                } else {
                    // 원본 텍스트 유지
                    writer.write_event(Event::Text(e.into_owned())).map_err(|e| CommandError {
                        code: "XML_ERROR".to_string(),
                        message: format!("XML write error: {}", e),
                        details: None,
                    })?;
                }
            }
            Ok(Event::Empty(e)) => {
                writer.write_event(Event::Empty(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::CData(e)) => {
                writer.write_event(Event::CData(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::Comment(e)) => {
                writer.write_event(Event::Comment(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::Decl(e)) => {
                writer.write_event(Event::Decl(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::PI(e)) => {
                writer.write_event(Event::PI(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::DocType(e)) => {
                writer.write_event(Event::DocType(e.into_owned())).map_err(|e| CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML write error: {}", e),
                    details: None,
                })?;
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(CommandError {
                    code: "XML_ERROR".to_string(),
                    message: format!("XML parsing error: {}", e),
                    details: None,
                });
            }
        }
    }

    let result = writer.into_inner();
    String::from_utf8(result).map_err(|e| CommandError {
        code: "ENCODING_ERROR".to_string(),
        message: format!("UTF-8 encoding error: {}", e),
        details: None,
    })
}
