import { useEffect, useState, useCallback, type RefObject } from 'react';
import { isTauriRuntime } from '@/tauri/invoke';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { saveTempImage } from '@/tauri/attachments';
import { pickChatAttachmentFile } from '@/tauri/dialog';
import { fileToBytes, isImageFile } from '@/utils/fileUtils';

/**
 * Tauri 드래그 앤 드롭 + HTML5 fallback + 클립보드 이미지 붙여넣기
 */
interface UseChatDragDropOptions {
  enabled?: boolean;
  dropZoneRef?: RefObject<HTMLElement>;
}

export function useChatDragDrop(
  addComposerAttachment: (path: string) => Promise<void>,
  options: UseChatDragDropOptions = {},
) {
  const { enabled = true, dropZoneRef } = options;
  const [isDragging, setIsDragging] = useState(false);

  const isInsideDropZone = useCallback((position: { x: number; y: number }): boolean => {
    if (!dropZoneRef?.current) return true;
    const rect = dropZoneRef.current.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const scaledX = position.x / scale;
    const scaledY = position.y / scale;
    const inScaled = scaledX >= rect.left && scaledX <= rect.right && scaledY >= rect.top && scaledY <= rect.bottom;
    const inRaw = position.x >= rect.left && position.x <= rect.right && position.y >= rect.top && position.y <= rect.bottom;
    return inScaled || inRaw;
  }, [dropZoneRef]);

  // Tauri 드래그 앤 드롭 이벤트 리스너
  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        const webview = getCurrentWebview();
        const unlistenFn = await webview.onDragDropEvent(async (event) => {
          if (cancelled) return;

          if (event.payload.type === 'over' || event.payload.type === 'enter') {
            setIsDragging(isInsideDropZone(event.payload.position));
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            if (!isInsideDropZone(event.payload.position)) return;
            const paths = event.payload.paths;

            for (const path of paths) {
              try {
                await addComposerAttachment(path);
              } catch (error) {
                console.error('Failed to add dropped file:', error);
              }
            }
          } else {
            // cancelled
            setIsDragging(false);
          }
        });

        // cleanup이 이미 호출된 경우 즉시 unlisten
        if (cancelled) {
          unlistenFn();
        } else {
          unlisten = unlistenFn;
        }
      } catch (error) {
        console.error('Failed to setup drag drop listener:', error);
      }
    };

    void setupListener();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [addComposerAttachment, enabled, isInsideDropZone]);

  // HTML5 드래그 앤 드롭 핸들러 (브라우저 fallback)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [enabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && target.contains(related)) return;
    setIsDragging(false);
  }, [enabled]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Tauri에서는 onDragDropEvent를 사용하므로 여기서는 처리하지 않음
    if (isTauriRuntime()) return;

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      if (isImageFile(file)) {
        try {
          const bytes = await fileToBytes(file);
          const path = await saveTempImage(bytes, file.name);
          await addComposerAttachment(path);
        } catch (error) {
          console.error('Failed to process dropped image:', error);
        }
      } else {
        const path = await pickChatAttachmentFile();
        if (path) {
          await addComposerAttachment(path);
        }
        break;
      }
    }
  }, [addComposerAttachment, enabled]);

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
}
