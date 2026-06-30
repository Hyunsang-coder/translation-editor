import { useCallback } from 'react';
import { isTauriRuntime } from '@/tauri/invoke';
import { readNativeClipboardImageBlob } from '@/tauri/clipboardImage';
import { saveTempImage } from '@/tauri/attachments';
import { pickChatAttachmentFile } from '@/tauri/dialog';
import { fileToBytes } from '@/utils/fileUtils';
import {
  extractClipboardImageFromDataTransfer,
  type ClipboardImagePayload,
} from '@/utils/clipboardImage';

async function attachClipboardImage(
  image: ClipboardImagePayload,
  addComposerAttachment: (path: string) => Promise<void>,
): Promise<void> {
  const bytes = await fileToBytes(image.blob);
  const path = await saveTempImage(bytes, image.filename);
  await addComposerAttachment(path);
}

function hasMeaningfulPastedText(dataTransfer: DataTransfer | null): boolean {
  const pastedText = dataTransfer?.getData('text/plain')?.trim();
  return Boolean(pastedText);
}

/**
 * 채팅 컴포저의 붙여넣기/첨부파일 핸들러
 */
export function useChatComposerHandlers(addComposerAttachment: (path: string) => Promise<void>) {
  const handleComposerPaste = useCallback((event: ClipboardEvent): boolean => {
    const webImage = extractClipboardImageFromDataTransfer(event.clipboardData);
    if (webImage) {
      void attachClipboardImage(webImage, addComposerAttachment).catch((error) => {
        console.error('Failed to process pasted image:', error);
      });
      return true;
    }

    if (hasMeaningfulPastedText(event.clipboardData)) {
      return false;
    }

    if (!isTauriRuntime()) {
      return false;
    }

    void readNativeClipboardImageBlob()
      .then((blob) => {
        if (!blob) return;
        return attachClipboardImage(
          { blob, filename: `clipboard-${Date.now()}.png` },
          addComposerAttachment,
        );
      })
      .catch((error) => {
        console.error('Failed to read native clipboard image:', error);
      });

    return true;
  }, [addComposerAttachment]);

  const handleAttachClick = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const path = await pickChatAttachmentFile();
    if (path) {
      await addComposerAttachment(path);
    }
  }, [addComposerAttachment]);

  return { handleComposerPaste, handleAttachClick };
}
