import { isImageMimeType } from '@/utils/fileUtils';

export interface ClipboardImagePayload {
  blob: Blob;
  filename: string;
}

/**
 * paste 이벤트의 DataTransfer에서 이미지 파일을 동기적으로 추출합니다.
 */
export function extractClipboardImageFromDataTransfer(
  dataTransfer: DataTransfer | null,
): ClipboardImagePayload | null {
  if (!dataTransfer) return null;

  const items = dataTransfer.items;
  if (items) {
    for (const item of items) {
      if (!isImageMimeType(item.type)) continue;

      const blob = item.getAsFile();
      if (!blob) continue;

      const ext = item.type.split('/')[1]?.split('+')[0] || 'png';
      return {
        blob,
        filename: `clipboard-${Date.now()}.${ext}`,
      };
    }
  }

  const files = dataTransfer.files;
  if (files) {
    for (const file of files) {
      if (!isImageMimeType(file.type)) continue;

      return {
        blob: file,
        filename: file.name || `clipboard-${Date.now()}.png`,
      };
    }
  }

  return null;
}

/**
 * RGBA 픽셀 데이터를 PNG Blob으로 변환합니다.
 * Tauri readImage()는 RGBA를 반환하므로 save_temp_image에 넣기 전 변환이 필요합니다.
 */
export function rgbaToPngBlob(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas 2D context unavailable'));
      return;
    }

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode clipboard image as PNG'));
        }
      },
      'image/png',
    );
  });
}
