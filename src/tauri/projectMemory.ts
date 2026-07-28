import type {
  ForbiddenTerm,
  ProjectMemoryCategory,
  ProjectMemoryItem,
} from '@/types';
import { invoke } from '@/tauri/invoke';

interface ProjectMemoryItemWire extends Omit<
  ProjectMemoryItem,
  'sourceSessionId' | 'sourceMessageId' | 'sourceSelectionId'
> {
  sourceSessionId: string | null;
  sourceMessageId: string | null;
  sourceSelectionId: string | null;
}

interface ForbiddenTermWire extends Omit<ForbiddenTerm, 'replacement' | 'note'> {
  replacement: string | null;
  note: string | null;
}

interface ProjectMemorySnapshotWire {
  projectId: string;
  items: ProjectMemoryItemWire[];
  forbiddenTerms: ForbiddenTermWire[];
  revision: number;
}

export interface ProjectMemorySnapshot {
  projectId: string;
  items: ProjectMemoryItem[];
  forbiddenTerms: ForbiddenTerm[];
  revision: number;
}

export interface ProjectMemoryItemInput {
  category: ProjectMemoryCategory;
  content: string;
  source: ProjectMemoryItem['source'];
  status?: ProjectMemoryItem['status'];
  sourceSessionId?: string;
  sourceMessageId?: string;
  sourceSelectionId?: string;
}

export interface ForbiddenTermInput {
  id?: string;
  term: string;
  replacement?: string;
  note?: string;
  enabled: boolean;
}

export interface AddProjectMemoryResult {
  item: ProjectMemoryItem;
  revision: number;
  duplicate: boolean;
}

export interface ReplaceProjectMemoryResult {
  item: ProjectMemoryItem;
  revision: number;
}

export interface UpsertForbiddenTermResult {
  term: ForbiddenTerm;
  revision: number;
}

function fromMemoryWire(item: ProjectMemoryItemWire): ProjectMemoryItem {
  return {
    id: item.id,
    projectId: item.projectId,
    category: item.category,
    content: item.content,
    normalizedHash: item.normalizedHash,
    status: item.status,
    source: item.source,
    ...(item.sourceSessionId ? { sourceSessionId: item.sourceSessionId } : {}),
    ...(item.sourceMessageId ? { sourceMessageId: item.sourceMessageId } : {}),
    ...(item.sourceSelectionId ? { sourceSelectionId: item.sourceSelectionId } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function fromForbiddenTermWire(term: ForbiddenTermWire): ForbiddenTerm {
  return {
    id: term.id,
    projectId: term.projectId,
    term: term.term,
    ...(term.replacement ? { replacement: term.replacement } : {}),
    ...(term.note ? { note: term.note } : {}),
    enabled: term.enabled,
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}

export async function loadProjectMemory(projectId: string): Promise<ProjectMemorySnapshot> {
  const result = await invoke<ProjectMemorySnapshotWire>('load_project_memory', {
    args: { projectId },
  });
  return {
    projectId: result.projectId,
    items: result.items.map(fromMemoryWire),
    forbiddenTerms: result.forbiddenTerms.map(fromForbiddenTermWire),
    revision: result.revision,
  };
}

export async function migrateLegacyProjectMemory(params: {
  projectId: string;
  content: string;
}): Promise<boolean> {
  return await invoke<boolean>('migrate_legacy_project_memory', {
    args: params,
  });
}

export async function addProjectMemoryItem(params: {
  projectId: string;
  input: ProjectMemoryItemInput;
}): Promise<AddProjectMemoryResult> {
  const result = await invoke<{
    item: ProjectMemoryItemWire;
    revision: number;
    duplicate: boolean;
  }>('add_project_memory_item', {
    args: {
      projectId: params.projectId,
      ...params.input,
      status: params.input.status ?? 'active',
      sourceSessionId: params.input.sourceSessionId ?? null,
      sourceMessageId: params.input.sourceMessageId ?? null,
      sourceSelectionId: params.input.sourceSelectionId ?? null,
    },
  });
  return { ...result, item: fromMemoryWire(result.item) };
}

export async function replaceProjectMemoryItem(params: {
  projectId: string;
  targetItemId: string;
  input: ProjectMemoryItemInput;
}): Promise<ReplaceProjectMemoryResult> {
  const result = await invoke<{
    item: ProjectMemoryItemWire;
    revision: number;
  }>('replace_project_memory_item', {
    args: {
      projectId: params.projectId,
      targetItemId: params.targetItemId,
      ...params.input,
      sourceSessionId: params.input.sourceSessionId ?? null,
      sourceMessageId: params.input.sourceMessageId ?? null,
      sourceSelectionId: params.input.sourceSelectionId ?? null,
    },
  });
  return { item: fromMemoryWire(result.item), revision: result.revision };
}

export async function deleteProjectMemoryItem(params: {
  projectId: string;
  itemId: string;
}): Promise<{ revision: number }> {
  return await invoke<{ revision: number }>('delete_project_memory_item', {
    args: params,
  });
}

export async function upsertForbiddenTerm(params: {
  projectId: string;
  input: ForbiddenTermInput;
}): Promise<UpsertForbiddenTermResult> {
  const result = await invoke<{
    term: ForbiddenTermWire;
    revision: number;
  }>('upsert_forbidden_term', {
    args: {
      projectId: params.projectId,
      id: params.input.id ?? null,
      term: params.input.term,
      replacement: params.input.replacement ?? null,
      note: params.input.note ?? null,
      enabled: params.input.enabled,
    },
  });
  return { term: fromForbiddenTermWire(result.term), revision: result.revision };
}

export async function deleteForbiddenTerm(params: {
  projectId: string;
  id: string;
}): Promise<{ revision: number }> {
  return await invoke<{ revision: number }>('delete_forbidden_term', {
    args: params,
  });
}
