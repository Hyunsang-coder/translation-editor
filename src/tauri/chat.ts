import type { ChatSession } from '@/types';
import { invoke } from '@/tauri/invoke';

export interface ChatProjectSettings {
  systemPromptOverlay: string;
  referenceNotes: string;
  activeMemory: string;
  includeSourceInPayload: boolean;
  includeTargetInPayload: boolean;
}

export async function saveCurrentChatSession(params: {
  projectId: string;
  session: ChatSession;
}): Promise<void> {
  await invoke<void>('save_current_chat_session', {
    args: { projectId: params.projectId, session: params.session },
  });
}

export async function loadCurrentChatSession(projectId: string): Promise<ChatSession | null> {
  return await invoke<ChatSession | null>('load_current_chat_session', { args: { projectId } });
}

export async function saveChatProjectSettings(params: {
  projectId: string;
  settings: ChatProjectSettings;
}): Promise<void> {
  await invoke<void>('save_chat_project_settings', {
    args: { projectId: params.projectId, settings: params.settings },
  });
}

export async function loadChatProjectSettings(projectId: string): Promise<ChatProjectSettings | null> {
  return await invoke<ChatProjectSettings | null>('load_chat_project_settings', { args: { projectId } });
}


