import { invoke } from '@/tauri/invoke';

export async function exportProjectFile(path: string): Promise<void> {
  await invoke<void>('export_project_file', { path });
}

export async function deleteProject(projectId: string): Promise<void> {
  await invoke<void>('delete_project', { projectId });
}

export async function deleteAllProjects(): Promise<void> {
  await invoke<void>('delete_all_projects');
}

export interface ImportProjectFileSafeResult {
  projectIds: string[];
  backupPath: string;
}

export async function importProjectFile(path: string): Promise<string[]> {
  return await invoke<string[]>('import_project_file', { path });
}

export async function importProjectFileSafe(path: string): Promise<ImportProjectFileSafeResult> {
  return await invoke<ImportProjectFileSafeResult>('import_project_file_safe', { path });
}

export async function listProjectIds(): Promise<string[]> {
  return await invoke<string[]>('list_project_ids');
}

export interface RecentProjectInfo {
  id: string;
  title: string;
  updatedAt: number;
}

export async function listRecentProjects(): Promise<RecentProjectInfo[]> {
  return await invoke<RecentProjectInfo[]>('list_recent_projects');
}


