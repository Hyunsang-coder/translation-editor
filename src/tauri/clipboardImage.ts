import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { isTauriRuntime } from '@/tauri/invoke';
import { rgbaToPngBlob } from '@/utils/clipboardImage';

/**
 * Tauri 네이티브 클립보드에서 이미지를 읽습니다.
 * WKWebView paste 이벤트에 이미지가 노출되지 않을 때 fallback으로 사용합니다.
 */
export async function readNativeClipboardImageBlob(): Promise<Blob | null> {
  if (!isTauriRuntime()) return null;

  try {
    const image = await readImage();
    const { width, height } = await image.size();
    if (!width || !height) return null;

    const rgba = await image.rgba();
    return await rgbaToPngBlob(rgba, width, height);
  } catch {
    return null;
  }
}
