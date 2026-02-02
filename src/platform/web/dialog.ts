/**
 * Web Dialog Adapter
 *
 * Web File API와 브라우저 대화상자를 사용합니다.
 */

import type { DialogAdapter } from '../types';

export const webDialogAdapter: DialogAdapter = {
  pickFile: async (options) => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = options.multiple ?? false;

      // Build accept string from filters
      if (options.filters && options.filters.length > 0) {
        const extensions = options.filters.flatMap((f) =>
          f.extensions.map((ext) => `.${ext}`)
        );
        input.accept = extensions.join(',');
      }

      input.onchange = () => {
        const file = input.files?.[0];
        if (file) {
          // Web File API에서는 실제 파일 경로에 접근할 수 없음
          // 대신 File 객체의 name을 반환하고, 파일 내용은 별도로 처리
          // 실제로는 ObjectURL이나 File 객체를 사용해야 함
          resolve(file.name);
        } else {
          resolve(null);
        }
      };

      input.oncancel = () => {
        resolve(null);
      };

      input.click();
    });
  },

  saveFile: async (options) => {
    // Web에서는 직접적인 파일 저장 경로 선택이 제한적
    // File System Access API가 지원되는 경우에만 사용 가능
    if ('showSaveFilePicker' in window) {
      try {
        const fileTypes = options.filters?.map((f) => ({
          description: f.name,
          accept: {
            'application/octet-stream': f.extensions.map((ext) => `.${ext}`),
          },
        })) ?? [];

        const handle = await (window as any).showSaveFilePicker({
          suggestedName: options.defaultPath,
          types: fileTypes,
        });

        return handle.name;
      } catch (e) {
        // User cancelled or API not supported
        return null;
      }
    }

    // Fallback: 파일명만 반환 (실제 저장은 별도 처리)
    return options.defaultPath ?? null;
  },

  confirm: async (message) => {
    return window.confirm(message);
  },

  alert: async (message) => {
    window.alert(message);
  },
};

// ============================================
// Web File Picker with File Object
// ============================================

export interface PickedFile {
  name: string;
  type: string;
  size: number;
  file: File;
}

/**
 * 파일 선택 후 File 객체 반환 (Web 전용)
 */
export async function pickFileWithContent(options: {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = options.multiple ?? false;

    if (options.filters && options.filters.length > 0) {
      const extensions = options.filters.flatMap((f) =>
        f.extensions.map((ext) => `.${ext}`)
      );
      input.accept = extensions.join(',');
    }

    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        resolve({
          name: file.name,
          type: file.type,
          size: file.size,
          file,
        });
      } else {
        resolve(null);
      }
    };

    input.oncancel = () => {
      resolve(null);
    };

    input.click();
  });
}
