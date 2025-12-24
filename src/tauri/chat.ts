import type { ChatSession } from '@/types';
import { invoke } from '@/tauri/invoke';

export interface ChatProjectSettings {
  translatorPersona: string;
  translationRules: string;
  /**
   * Project Context: 번역 시 참고할 추가 맥락 정보(배경 지식, 프로젝트 컨텍스트 등)
   */
  projectContext: string;
  composerText: string;
  /**
   * 문서 전체 번역(Preview→Apply) 시 컨텍스트로 사용할 채팅 탭
   * - null: 현재 탭(currentSession) 사용
   * - string: 특정 sessionId 고정 사용
   */
  translationContextSessionId: string | null;
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


