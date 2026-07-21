import type {
  GlossaryEntry,
  GlossarySummary,
  ProjectDomain,
  ProjectGlossary,
} from '@/types';
import { invoke } from '@/tauri/invoke';

export interface ImportGlossaryCsvResult {
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export async function exportGlossary(params: {
  glossaryId: string;
  path: string;
  format: 'csv' | 'excel';
}): Promise<void> {
  await invoke<void>('export_glossary', {
    args: {
      glossaryId: params.glossaryId,
      path: params.path,
      format: params.format,
    },
  });
}

export async function importGlossaryCsv(params: {
  glossaryId: string;
  path: string;
  replaceEntries?: boolean;
}): Promise<ImportGlossaryCsvResult> {
  return await invoke<ImportGlossaryCsvResult>('import_glossary_csv', {
    args: {
      glossaryId: params.glossaryId,
      path: params.path,
      replaceEntries: params.replaceEntries ?? false,
    },
  });
}

export async function importGlossaryExcel(params: {
  glossaryId: string;
  path: string;
  replaceEntries?: boolean;
}): Promise<ImportGlossaryCsvResult> {
  return await invoke<ImportGlossaryCsvResult>('import_glossary_excel', {
    args: {
      glossaryId: params.glossaryId,
      path: params.path,
      replaceEntries: params.replaceEntries ?? false,
    },
  });
}

export async function searchGlossary(params: {
  projectId: string;
  query: string;
  limit?: number;
  domain?: ProjectDomain | string;
}): Promise<GlossaryEntry[]> {
  return await invoke<GlossaryEntry[]>('search_glossary', {
    args: {
      projectId: params.projectId,
      query: params.query,
      limit: params.limit ?? 12,
      domain: params.domain ?? null,
    },
  });
}

export async function listGlossaries(): Promise<GlossarySummary[]> {
  return await invoke<GlossarySummary[]>('list_glossaries');
}

export async function createGlossary(params: {
  name: string;
  description?: string | null;
}): Promise<GlossarySummary> {
  return await invoke<GlossarySummary>('create_glossary', {
    args: {
      name: params.name,
      description: params.description ?? null,
    },
  });
}

export async function updateGlossary(params: {
  glossaryId: string;
  name: string;
  description?: string | null;
}): Promise<GlossarySummary> {
  return await invoke<GlossarySummary>('update_glossary', {
    args: {
      glossaryId: params.glossaryId,
      name: params.name,
      description: params.description ?? null,
    },
  });
}

export async function deleteGlossary(glossaryId: string): Promise<void> {
  await invoke<void>('delete_glossary', {
    args: { glossaryId },
  });
}

export async function listGlossaryEntries(params: {
  glossaryId: string;
  query?: string;
}): Promise<GlossaryEntry[]> {
  return await invoke<GlossaryEntry[]>('list_glossary_entries', {
    args: {
      glossaryId: params.glossaryId,
      query: params.query?.trim() || null,
    },
  });
}

export interface GlossaryEntryInput {
  glossaryId: string;
  source: string;
  target: string;
  notes?: string | null;
  domain?: ProjectDomain | string | null;
  caseSensitive?: boolean;
}

export async function createGlossaryEntry(
  params: GlossaryEntryInput,
): Promise<GlossaryEntry> {
  return await invoke<GlossaryEntry>('create_glossary_entry', {
    args: {
      glossaryId: params.glossaryId,
      source: params.source,
      target: params.target,
      notes: params.notes ?? null,
      domain: params.domain ?? null,
      caseSensitive: params.caseSensitive ?? false,
    },
  });
}

export async function updateGlossaryEntry(
  params: Omit<GlossaryEntryInput, 'glossaryId'> & { entryId: string },
): Promise<GlossaryEntry> {
  return await invoke<GlossaryEntry>('update_glossary_entry', {
    args: {
      entryId: params.entryId,
      source: params.source,
      target: params.target,
      notes: params.notes ?? null,
      domain: params.domain ?? null,
      caseSensitive: params.caseSensitive ?? false,
    },
  });
}

export async function deleteGlossaryEntry(entryId: string): Promise<void> {
  await invoke<void>('delete_glossary_entry', {
    args: { entryId },
  });
}

export async function listProjectGlossaries(projectId: string): Promise<ProjectGlossary[]> {
  return await invoke<ProjectGlossary[]>('list_project_glossaries', {
    args: { projectId },
  });
}

export async function setProjectGlossaries(params: {
  projectId: string;
  glossaryIds: string[];
}): Promise<ProjectGlossary[]> {
  return await invoke<ProjectGlossary[]>('set_project_glossaries', {
    args: {
      projectId: params.projectId,
      glossaryIds: params.glossaryIds,
    },
  });
}
