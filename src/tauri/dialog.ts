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


