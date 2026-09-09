import { useCallback } from 'react';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { isTauriRuntime } from '@/tauri/invoke';
import { readNativeClipboardImageBlob } from '@/tauri/clipboardImage';
import { saveTempImage } from '@/tauri/attachments';
import { pickChatAttachmentFile } from '@/tauri/dialog';
import {
  extractClipboardImageFromDataTransfer,
  type ClipboardImagePayload,
} from '@/utils/clipboardImage';

async function attachClipboardImage(
  image: ClipboardImagePayload,
  addComposerAttachment: (path: string) => Promise<void>,
): Promise<void> {
  // P5: Blob → base64 문자열로 직접 IPC (number[] 직렬화 프리즈 방지)
  const path = await saveTempImage(image.blob, image.filename);
  await addComposerAttachment(path);
}

async function pasteNativeClipboardFallback(
  addComposerAttachment: (path: string) => Promise<void>,
  insertNativeText: (text: string) => void,
): Promise<void> {
  try {
    const text = (await readText()).trim();
    if (text) {
      insertNativeText(text);
      return;
    }
  } catch (error) {
    // 텍스트가 아닌 이미지 클립보드에서는 readText가 실패할 수 있다.
    console.debug('Failed to read native clipboard text:', error);
  }

  const blob = await readNativeClipboardImageBlob();
  if (!blob) return;
  await attachClipboardImage(
    { blob, filename: `clipboard-${Date.now()}.png` },
    addComposerAttachment,
  );
}

/** WKWebView가 직접 전달한 plain text만 기본 붙여넣기에 맡긴다. */
export function hasMeaningfulPastedText(dataTransfer: DataTransfer | null): boolean {
  const plainText = dataTransfer?.getData('text/plain')?.trim();
  return Boolean(plainText);
}

function hasPastedTable(dataTransfer: DataTransfer | null): boolean {
  const html = dataTransfer?.getData('text/html') ?? '';
  return /<table(?:\s|>)/i.test(html);
}

/**
 * 채팅 컴포저의 붙여넣기/첨부파일 핸들러
 */
export function useChatComposerHandlers(
  addComposerAttachment: (path: string) => Promise<void>,
  insertNativeText: (text: string) => void,
) {
  const handleComposerPaste = useCallback((event: ClipboardEvent): boolean => {
    if (hasPastedTable(event.clipboardData)) {
      const plainText = event.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (plainText) {
        insertNativeText(plainText);
        return true;
      }

      if (isTauriRuntime()) {
        void pasteNativeClipboardFallback(addComposerAttachment, insertNativeText)
          .catch((error) => {
            console.error('Failed to read native table clipboard:', error);
          });
        return true;
      }
    }

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

    void pasteNativeClipboardFallback(addComposerAttachment, insertNativeText)
      .catch((error) => {
        console.error('Failed to read native clipboard:', error);
      });

    return true;
  }, [addComposerAttachment, insertNativeText]);

  const handleAttachClick = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const path = await pickChatAttachmentFile();
    if (path) {
      await addComposerAttachment(path);
    }
  }, [addComposerAttachment]);

  return { handleComposerPaste, handleAttachClick };
}
