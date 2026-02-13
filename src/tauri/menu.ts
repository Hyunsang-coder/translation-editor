import { invoke } from '@/tauri/invoke';

export async function setViewChatMenuChecked(checked: boolean): Promise<void> {
  await invoke<void>('set_view_chat_menu_checked', { checked });
}
