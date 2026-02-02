import { open, save } from '@tauri-apps/plugin-dialog';

export async function pickImportIteFile(): Promise<string | null> {
  const file = await open({
    title: 'Import .ite 파일 선택',
    multiple: false,
    filters: [{ name: 'ITE Project', extensions: ['ite'] }],
  });
  if (!file) return null;
  // open()은 string 또는 string[]를 반환할 수 있음
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

export async function pickExportItePath(defaultName = 'project.ite'): Promise<string | null> {
  const path = await save({
    title: 'Export .ite 저장 위치 선택',
    defaultPath: defaultName,
    filters: [{ name: 'ITE Project', extensions: ['ite'] }],
  });
  return path ?? null;
}

export async function pickGlossaryCsvFile(): Promise<string | null> {
  const file = await open({
    title: '글로서리 CSV 파일 선택',
    multiple: false,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!file) return null;
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

export async function pickGlossaryExcelFile(): Promise<string | null> {
  const file = await open({
    title: '글로서리 Excel 파일 선택',
    multiple: false,
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
  });
  if (!file) return null;
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

export async function pickGlossaryFile(): Promise<string | null> {
  const file = await open({
    title: '용어집 파일 선택',
    multiple: false,
    filters: [{ name: 'Glossary', extensions: ['csv', 'xlsx', 'xls'] }],
  });
  if (!file) return null;
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

export async function pickDocumentFile(): Promise<string | null> {
  const file = await open({
    title: '첨부할 문서 선택',
    multiple: false,
    filters: [
      {
        name: 'Documents',
        extensions: ['pdf', 'docx', 'pptx', 'md', 'txt'],
      },
    ],
  });
  if (!file) return null;
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

export async function pickChatAttachmentFile(): Promise<string | null> {
  const file = await open({
    title: '첨부할 파일/이미지 선택',
    multiple: false,
    filters: [
      {
        name: 'Attachments',
        extensions: ['pdf', 'docx', 'pptx', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
      },
    ],
  });
  if (!file) return null;
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

/**
 * PPTX 파일 선택 다이얼로그
 */
export async function pickPptxFile(): Promise<string | null> {
  const file = await open({
    title: 'PPTX 파일 선택',
    multiple: false,
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });
  if (!file) return null;
  return Array.isArray(file) ? (file[0] ?? null) : file;
}

/**
 * 번역된 PPTX 저장 경로 선택 다이얼로그
 * @param defaultName 기본 파일명
 */
export async function pickTranslatedPptxSavePath(defaultName: string): Promise<string | null> {
  const path = await save({
    title: '번역된 PPTX 저장 위치 선택',
    defaultPath: defaultName,
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });
  return path ?? null;
}
