import { useCallback } from 'react';
import { isTauriRuntime } from '@/tauri/invoke';
import { saveTempImage } from '@/tauri/attachments';
import { pickChatAttachmentFile } from '@/tauri/dialog';
import { fileToBytes, isImageMimeType } from '@/utils/fileUtils';

/**
 * 채팅 컴포저의 붙여넣기/첨부파일 핸들러
 */
export function useChatComposerHandlers(addComposerAttachment: (path: string) => Promise<void>) {
  // 클립보드 붙여넣기 핸들러 (이미지)
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    for (const item of items) {
      if (isImageMimeType(item.type)) {
        e.preventDefault();

        const blob = item.getAsFile();
        if (!blob) continue;

        const ext = item.type.split('/')[1] || 'png';
        const filename = `clipboard-${Date.now()}.${ext}`;

        try {
          const bytes = await fileToBytes(blob);
          const path = await saveTempImage(bytes, filename);
          await addComposerAttachment(path);
        } catch (error) {
          console.error('Failed to process pasted image:', error);
        }
        return;
      }
    }
    // 텍스트 붙여넣기는 기본 동작 유지
  }, [addComposerAttachment]);

  // 파일 첨부 버튼 클릭 핸들러
  const handleAttachClick = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const path = await pickChatAttachmentFile();
    if (path) {
      await addComposerAttachment(path);
    }
  }, [addComposerAttachment]);

  return { handlePaste, handleAttachClick };
}
