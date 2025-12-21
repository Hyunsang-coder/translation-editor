import type { ITEProject, ProjectDomain } from '@/types';
import { invoke } from '@/tauri/invoke';

export interface CreateProjectParams {
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain: ProjectDomain;
}

export async function createProject(params: CreateProjectParams): Promise<ITEProject> {
  return await invoke<ITEProject>('create_project', {
    title: params.title,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    domain: params.domain,
  });
}

export async function saveProject(project: ITEProject): Promise<void> {
  await invoke<void>('save_project', { project });
}

export async function loadProject(projectId: string): Promise<ITEProject> {
  return await invoke<ITEProject>('load_project', { projectId });
}


