import type { GlossaryEntry, ProjectDomain } from '@/types';
import { invoke } from '@/tauri/invoke';

export interface ImportGlossaryCsvResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export async function importGlossaryCsv(params: {
  projectId: string;
  path: string;
  replaceProjectScope?: boolean;
}): Promise<ImportGlossaryCsvResult> {
  return await invoke<ImportGlossaryCsvResult>('import_glossary_csv', {
    projectId: params.projectId,
    path: params.path,
    replaceProjectScope: params.replaceProjectScope ?? false,
  });
}

export async function importGlossaryExcel(params: {
  projectId: string;
  path: string;
  replaceProjectScope?: boolean;
}): Promise<ImportGlossaryCsvResult> {
  return await invoke<ImportGlossaryCsvResult>('import_glossary_excel', {
    projectId: params.projectId,
    path: params.path,
    replaceProjectScope: params.replaceProjectScope ?? false,
  });
}

export async function searchGlossary(params: {
  projectId: string;
  query: string;
  limit?: number;
  domain?: ProjectDomain | string;
}): Promise<GlossaryEntry[]> {
  return await invoke<GlossaryEntry[]>('search_glossary', {
    projectId: params.projectId,
    query: params.query,
    limit: params.limit ?? 12,
    domain: params.domain ?? null,
  });
}


