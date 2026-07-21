//! Glossary Commands
//!
//! 로컬 글로서리(CSV) 임포트 및 검색 API
//! 임포트는 파일 파싱 + 배치 insert로 무거울 수 있어 async + `run_db_task`로 실행한다.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

use super::run_db_task;
use crate::db::DbState;
use crate::error::{CommandError, CommandResult};
use crate::utils::{validate_file_size, validate_path};

/// 글로서리 파일 최대 크기 (10MB)
const MAX_GLOSSARY_SIZE: u64 = 10 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGlossaryCsvArgs {
    /// 용어를 넣을 대상 용어집
    pub glossary_id: String,
    /// CSV 파일 경로(로컬 파일 시스템)
    pub path: String,
    /// true면 해당 용어집의 기존 엔트리를 모두 삭제 후 임포트
    pub replace_entries: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGlossaryResult {
    pub inserted: u32,
    pub updated: u32,
    pub skipped: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGlossaryExcelArgs {
    /// 용어를 넣을 대상 용어집
    pub glossary_id: String,
    /// Excel 파일 경로(.xlsx/.xls)
    pub path: String,
    /// true면 해당 용어집의 기존 엔트리를 모두 삭제 후 임포트
    pub replace_entries: Option<bool>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlossaryExportFormat {
    Csv,
    Excel,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportGlossaryArgs {
    pub glossary_id: String,
    pub path: String,
    pub format: GlossaryExportFormat,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub entry_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<crate::db::GlossaryRow> for GlossaryDto {
    fn from(row: crate::db::GlossaryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            description: row.description,
            entry_count: row.entry_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryLibraryEntryDto {
    pub id: String,
    pub glossary_id: String,
    pub source: String,
    pub target: String,
    pub notes: Option<String>,
    pub domain: Option<String>,
    pub case_sensitive: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<crate::db::GlossaryEntryRow> for GlossaryLibraryEntryDto {
    fn from(row: crate::db::GlossaryEntryRow) -> Self {
        Self {
            id: row.id,
            glossary_id: row.glossary_id,
            source: row.source,
            target: row.target,
            notes: row.notes,
            domain: row.domain,
            case_sensitive: row.case_sensitive,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGlossaryDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub entry_count: i64,
    pub priority: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<crate::db::ProjectGlossaryRow> for ProjectGlossaryDto {
    fn from(row: crate::db::ProjectGlossaryRow) -> Self {
        Self {
            id: row.glossary.id,
            name: row.glossary.name,
            description: row.glossary.description,
            entry_count: row.glossary.entry_count,
            priority: row.priority,
            created_at: row.glossary.created_at,
            updated_at: row.glossary.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGlossaryArgs {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameGlossaryArgs {
    pub glossary_id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGlossaryArgs {
    pub glossary_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGlossaryArgs {
    pub glossary_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListGlossaryEntriesArgs {
    pub glossary_id: String,
    pub query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGlossaryEntryArgs {
    pub glossary_id: String,
    pub source: String,
    pub target: String,
    pub notes: Option<String>,
    pub domain: Option<String>,
    pub case_sensitive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGlossaryEntryArgs {
    pub entry_id: String,
    pub source: String,
    pub target: String,
    pub notes: Option<String>,
    pub domain: Option<String>,
    pub case_sensitive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGlossaryEntryArgs {
    pub entry_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGlossariesArgs {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetProjectGlossariesArgs {
    pub project_id: String,
    /// 배열 순서가 0부터 시작하는 정수 priority가 됩니다.
    pub glossary_ids: Vec<String>,
}

/// CSV 글로서리 임포트
#[tauri::command]
pub async fn import_glossary_csv(
    args: ImportGlossaryCsvArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ImportGlossaryResult> {
    // 경로 검증 (시스템 디렉토리 접근 차단)
    let validated_path = validate_path(&args.path)?;

    validate_file_size(&validated_path, MAX_GLOSSARY_SIZE)?;

    run_db_task(&db_state, move |db| {
        let replace = args.replace_entries.unwrap_or(false);
        let (inserted, updated, skipped, warnings) = db
            .import_glossary_csv(
                &args.glossary_id,
                validated_path.to_string_lossy().as_ref(),
                replace,
            )
            .map_err(CommandError::from)?;

        Ok(ImportGlossaryResult {
            inserted,
            updated,
            skipped,
            warnings,
        })
    })
    .await
}

/// Excel(.xlsx/.xls) 글로서리 임포트
#[tauri::command]
pub async fn import_glossary_excel(
    args: ImportGlossaryExcelArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<ImportGlossaryResult> {
    // 경로 검증 (시스템 디렉토리 접근 차단)
    let validated_path = validate_path(&args.path)?;

    validate_file_size(&validated_path, MAX_GLOSSARY_SIZE)?;

    run_db_task(&db_state, move |db| {
        let replace = args.replace_entries.unwrap_or(false);
        let (inserted, updated, skipped, warnings) = db
            .import_glossary_excel(
                &args.glossary_id,
                validated_path.to_string_lossy().as_ref(),
                replace,
            )
            .map_err(CommandError::from)?;

        Ok(ImportGlossaryResult {
            inserted,
            updated,
            skipped,
            warnings,
        })
    })
    .await
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn build_glossary_csv(entries: &[crate::db::GlossaryEntryRow]) -> String {
    let mut output = String::from("\u{feff}Source,Target,Notes,Domain,CaseSensitive\r\n");
    for entry in entries {
        let fields = [
            csv_field(&entry.source),
            csv_field(&entry.target),
            csv_field(entry.notes.as_deref().unwrap_or("")),
            csv_field(entry.domain.as_deref().unwrap_or("")),
            entry.case_sensitive.to_string(),
        ];
        output.push_str(&fields.join(","));
        output.push_str("\r\n");
    }
    output
}

fn excel_sheet_name(glossary_name: &str) -> String {
    let sanitized = glossary_name
        .chars()
        .map(|ch| {
            if matches!(ch, '[' | ']' | ':' | '*' | '?' | '/' | '\\') {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim().trim_matches('\'');
    let name = if trimmed.is_empty() {
        "Glossary"
    } else {
        trimmed
    };
    name.chars().take(31).collect()
}

fn write_glossary_excel(
    path: &Path,
    glossary_name: &str,
    entries: &[crate::db::GlossaryEntryRow],
) -> CommandResult<()> {
    use rust_xlsxwriter::{Color, Format, FormatAlign, Workbook};

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(excel_sheet_name(glossary_name))
        .map_err(|error| CommandError {
            code: "XLSX_ERROR".to_string(),
            message: format!("Failed to name Excel worksheet: {error}"),
            details: None,
        })?;

    let header_format = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x4f46e5))
        .set_align(FormatAlign::Center);
    let text_format = Format::new().set_num_format("@").set_text_wrap();
    let headers = ["Source", "Target", "Notes", "Domain", "CaseSensitive"];
    for (column, header) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, column as u16, *header, &header_format)
            .map_err(|error| CommandError {
                code: "XLSX_ERROR".to_string(),
                message: format!("Failed to write Excel header: {error}"),
                details: None,
            })?;
    }

    for (index, entry) in entries.iter().enumerate() {
        let row = index as u32 + 1;
        let values = [
            entry.source.as_str(),
            entry.target.as_str(),
            entry.notes.as_deref().unwrap_or(""),
            entry.domain.as_deref().unwrap_or(""),
            if entry.case_sensitive {
                "true"
            } else {
                "false"
            },
        ];
        for (column, value) in values.iter().enumerate() {
            worksheet
                .write_string_with_format(row, column as u16, *value, &text_format)
                .map_err(|error| CommandError {
                    code: "XLSX_ERROR".to_string(),
                    message: format!("Failed to write Excel cell: {error}"),
                    details: None,
                })?;
        }
    }

    for (column, width) in [28.0, 28.0, 36.0, 18.0, 16.0].into_iter().enumerate() {
        worksheet
            .set_column_width(column as u16, width)
            .map_err(|error| CommandError {
                code: "XLSX_ERROR".to_string(),
                message: format!("Failed to size Excel column: {error}"),
                details: None,
            })?;
    }
    worksheet
        .set_freeze_panes(1, 0)
        .map_err(|error| CommandError {
            code: "XLSX_ERROR".to_string(),
            message: format!("Failed to freeze Excel header: {error}"),
            details: None,
        })?;
    worksheet
        .autofilter(0, 0, entries.len() as u32, 4)
        .map_err(|error| CommandError {
            code: "XLSX_ERROR".to_string(),
            message: format!("Failed to add Excel filter: {error}"),
            details: None,
        })?;

    workbook.save(path).map_err(|error| CommandError {
        code: "IO_ERROR".to_string(),
        message: format!("Failed to write Excel file: {error}"),
        details: Some(path.display().to_string()),
    })
}

fn write_glossary_export(
    path: &Path,
    format: GlossaryExportFormat,
    glossary_name: &str,
    entries: &[crate::db::GlossaryEntryRow],
) -> CommandResult<()> {
    match format {
        GlossaryExportFormat::Csv => {
            std::fs::write(path, build_glossary_csv(entries)).map_err(|error| CommandError {
                code: "IO_ERROR".to_string(),
                message: format!("Failed to write CSV file: {error}"),
                details: Some(path.display().to_string()),
            })
        }
        GlossaryExportFormat::Excel => write_glossary_excel(path, glossary_name, entries),
    }
}

/// 저장된 용어집 전체를 CSV 또는 Excel(.xlsx) 파일로 내보냅니다.
#[tauri::command]
pub async fn export_glossary(
    args: ExportGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    let validated_path = validate_path(&args.path)?;
    let glossary_id = args.glossary_id;
    let (glossary_name, entries) = run_db_task(&db_state, move |db| {
        let glossary = db
            .list_glossaries()
            .map_err(CommandError::from)?
            .into_iter()
            .find(|glossary| glossary.id == glossary_id)
            .ok_or_else(|| CommandError {
                code: "INVALID_OPERATION".to_string(),
                message: format!("Glossary not found: {glossary_id}"),
                details: None,
            })?;
        let entries = db
            .list_glossary_entries(&glossary_id, None)
            .map_err(CommandError::from)?;
        Ok((glossary.name, entries))
    })
    .await?;

    tauri::async_runtime::spawn_blocking(move || {
        write_glossary_export(&validated_path, args.format, &glossary_name, &entries)
    })
    .await
    .map_err(|error| CommandError {
        code: "TASK_JOIN_ERROR".to_string(),
        message: format!("Glossary export task failed to complete: {error}"),
        details: None,
    })?
}

#[tauri::command]
pub async fn list_glossaries(db_state: State<'_, DbState>) -> CommandResult<Vec<GlossaryDto>> {
    run_db_task(&db_state, move |db| {
        db.list_glossaries()
            .map(|rows| rows.into_iter().map(GlossaryDto::from).collect())
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_glossary(
    args: CreateGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<GlossaryDto> {
    run_db_task(&db_state, move |db| {
        db.create_glossary(&args.name, args.description.as_deref())
            .map(GlossaryDto::from)
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_glossary(
    args: UpdateGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<GlossaryDto> {
    run_db_task(&db_state, move |db| {
        db.update_glossary(&args.glossary_id, &args.name, args.description.as_deref())
            .map(GlossaryDto::from)
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn rename_glossary(
    args: RenameGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.rename_glossary(&args.glossary_id, &args.name)
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_glossary(
    args: DeleteGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.delete_glossary(&args.glossary_id)
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn list_glossary_entries(
    args: ListGlossaryEntriesArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<GlossaryLibraryEntryDto>> {
    run_db_task(&db_state, move |db| {
        db.list_glossary_entries(&args.glossary_id, args.query.as_deref())
            .map(|rows| {
                rows.into_iter()
                    .map(GlossaryLibraryEntryDto::from)
                    .collect()
            })
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_glossary_entry(
    args: CreateGlossaryEntryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<GlossaryLibraryEntryDto> {
    run_db_task(&db_state, move |db| {
        db.create_glossary_entry(
            &args.glossary_id,
            &args.source,
            &args.target,
            args.notes.as_deref(),
            args.domain.as_deref(),
            args.case_sensitive.unwrap_or(false),
        )
        .map(GlossaryLibraryEntryDto::from)
        .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_glossary_entry(
    args: UpdateGlossaryEntryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<GlossaryLibraryEntryDto> {
    run_db_task(&db_state, move |db| {
        db.update_glossary_entry(
            &args.entry_id,
            &args.source,
            &args.target,
            args.notes.as_deref(),
            args.domain.as_deref(),
            args.case_sensitive,
        )
        .map(GlossaryLibraryEntryDto::from)
        .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_glossary_entry(
    args: DeleteGlossaryEntryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<()> {
    run_db_task(&db_state, move |db| {
        db.delete_glossary_entry(&args.entry_id)
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn list_project_glossaries(
    args: ProjectGlossariesArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<ProjectGlossaryDto>> {
    run_db_task(&db_state, move |db| {
        db.list_project_glossaries(&args.project_id)
            .map(|rows| rows.into_iter().map(ProjectGlossaryDto::from).collect())
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn set_project_glossaries(
    args: SetProjectGlossariesArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<ProjectGlossaryDto>> {
    run_db_task(&db_state, move |db| {
        db.set_project_glossaries(&args.project_id, &args.glossary_ids)
            .map(|rows| rows.into_iter().map(ProjectGlossaryDto::from).collect())
            .map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub async fn reorder_project_glossaries(
    args: SetProjectGlossariesArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<ProjectGlossaryDto>> {
    run_db_task(&db_state, move |db| {
        db.reorder_project_glossaries(&args.project_id, &args.glossary_ids)
            .map(|rows| rows.into_iter().map(ProjectGlossaryDto::from).collect())
            .map_err(CommandError::from)
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchGlossaryArgs {
    pub project_id: String,
    pub query: String,
    pub limit: Option<u32>,
    pub domain: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryEntryDto {
    pub id: String,
    pub source: String,
    pub target: String,
    pub notes: Option<String>,
    pub domain: Option<String>,
    pub case_sensitive: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 글로서리 검색(비벡터, rule-based)
#[tauri::command]
pub async fn search_glossary(
    args: SearchGlossaryArgs,
    db_state: State<'_, DbState>,
) -> CommandResult<Vec<GlossaryEntryDto>> {
    run_db_task(&db_state, move |db| {
        let limit = args.limit.unwrap_or(12).min(50);
        let rows = db
            .search_glossary_in_text(&args.project_id, &args.query, args.domain.as_deref(), limit)
            .map_err(CommandError::from)?;

        Ok(rows
            .into_iter()
            .map(|r| GlossaryEntryDto {
                id: r.id,
                source: r.source,
                target: r.target,
                notes: r.notes,
                domain: r.domain,
                case_sensitive: r.case_sensitive,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect())
    })
    .await
}

#[cfg(test)]
mod export_tests {
    use super::*;
    use calamine::{open_workbook_auto, Reader};

    fn entry(source: &str, target: &str, notes: Option<&str>) -> crate::db::GlossaryEntryRow {
        crate::db::GlossaryEntryRow {
            id: format!("id-{source}"),
            glossary_id: "glossary-1".to_string(),
            source: source.to_string(),
            target: target.to_string(),
            notes: notes.map(str::to_string),
            domain: Some("game".to_string()),
            case_sensitive: true,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn csv_export_preserves_unicode_commas_quotes_and_newlines() {
        let csv = build_glossary_csv(&[entry(
            "Care, Package",
            "보급 \"상자\"",
            Some("첫 줄\n둘째 줄"),
        )]);

        assert!(csv.starts_with('\u{feff}'));
        assert_eq!(
            csv,
            "\u{feff}Source,Target,Notes,Domain,CaseSensitive\r\n\
             \"Care, Package\",\"보급 \"\"상자\"\"\",\"첫 줄\n둘째 줄\",game,true\r\n"
        );
    }

    #[test]
    fn excel_export_writes_import_compatible_columns_as_text() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("glossary.xlsx");
        let entries = vec![entry("=SUM(1,2)", "보급 상자", None)];

        write_glossary_excel(&path, "PUBG 공통", &entries).expect("write workbook");

        let mut workbook = open_workbook_auto(&path).expect("open workbook");
        assert_eq!(workbook.sheet_names(), &["PUBG 공통"]);
        let range = workbook
            .worksheet_range("PUBG 공통")
            .expect("read glossary sheet");
        let rows = range.rows().collect::<Vec<_>>();
        assert_eq!(
            rows[0].iter().map(ToString::to_string).collect::<Vec<_>>(),
            ["Source", "Target", "Notes", "Domain", "CaseSensitive"]
        );
        assert_eq!(rows[1][0].to_string(), "=SUM(1,2)");
        assert_eq!(rows[1][1].to_string(), "보급 상자");
        assert_eq!(rows[1][4].to_string(), "true");
    }

    #[test]
    fn excel_export_sanitizes_sheet_name_and_supports_empty_glossary() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("empty-glossary.xlsx");

        write_glossary_excel(&path, "'invalid:/[]*? glossary name that is too long'", &[])
            .expect("write workbook");

        let workbook = open_workbook_auto(&path).expect("open workbook");
        let sheet_name = &workbook.sheet_names()[0];
        assert!(sheet_name.chars().count() <= 31);
        assert!(!sheet_name
            .chars()
            .any(|ch| matches!(ch, '[' | ']' | ':' | '*' | '?' | '/' | '\\')));
    }
}
