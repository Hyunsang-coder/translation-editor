import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(),
  readText: vi.fn(),
  readNativeClipboardImageBlob: vi.fn(),
  saveTempImage: vi.fn(),
}));

vi.mock('@/tauri/invoke', () => ({ isTauriRuntime: mocks.isTauriRuntime }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: mocks.readText }));
vi.mock('@/tauri/clipboardImage', () => ({
  readNativeClipboardImageBlob: mocks.readNativeClipboardImageBlob,
}));
vi.mock('@/tauri/attachments', () => ({ saveTempImage: mocks.saveTempImage }));

import { hasMeaningfulPastedText, useChatComposerHandlers } from './useChatComposerHandlers';

function mockDataTransfer(values: Record<string, string>): DataTransfer {
  return {
    getData: (type: string) => values[type] ?? '',
  } as DataTransfer;
}

describe('hasMeaningfulPastedText', () => {
  it('plain text 없이 HTML 표만 있으면 네이티브 폴백 대상으로 남긴다', () => {
    const dataTransfer = mockDataTransfer({
      'text/html': '<table><tbody><tr><td>첫 셀</td></tr></tbody></table>',
    });

    expect(hasMeaningfulPastedText(dataTransfer)).toBe(false);
  });
});

describe('useChatComposerHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.readNativeClipboardImageBlob.mockResolvedValue(null);
  });

  it('WebView 붙여넣기 데이터가 비어도 네이티브 텍스트를 컴포저에 넣는다', async () => {
    mocks.readText.mockResolvedValue('첫 셀\t둘째 셀');
    const insertNativeText = vi.fn();
    const addAttachment = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatComposerHandlers(addAttachment, insertNativeText),
    );

    const handled = result.current.handleComposerPaste({
      clipboardData: mockDataTransfer({}),
    } as ClipboardEvent);

    expect(handled).toBe(true);
    await waitFor(() => {
      expect(insertNativeText).toHaveBeenCalledWith('첫 셀\t둘째 셀');
    });
    expect(mocks.readNativeClipboardImageBlob).not.toHaveBeenCalled();
  });

  it('WebView가 HTML만 제공해도 네이티브 plain text를 컴포저에 넣는다', async () => {
    mocks.readText.mockResolvedValue('첫 셀\t둘째 셀');
    const insertNativeText = vi.fn();
    const addAttachment = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatComposerHandlers(addAttachment, insertNativeText),
    );

    const handled = result.current.handleComposerPaste({
      clipboardData: mockDataTransfer({
        'text/html': '<table><tbody><tr><td>첫 셀</td><td>둘째 셀</td></tr></tbody></table>',
      }),
    } as ClipboardEvent);

    expect(handled).toBe(true);
    await waitFor(() => {
      expect(insertNativeText).toHaveBeenCalledWith('첫 셀\t둘째 셀');
    });
    expect(mocks.readNativeClipboardImageBlob).not.toHaveBeenCalled();
  });

  it('표 HTML과 plain text가 함께 있으면 TipTap 기본 paste 대신 plain text를 직접 넣는다', () => {
    const insertNativeText = vi.fn();
    const addAttachment = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useChatComposerHandlers(addAttachment, insertNativeText),
    );

    const handled = result.current.handleComposerPaste({
      clipboardData: mockDataTransfer({
        'text/html': '<table><tbody><tr><td>첫 셀</td><td>둘째 셀</td></tr></tbody></table>',
        'text/plain': '첫 셀\t둘째 셀',
      }),
    } as ClipboardEvent);

    expect(handled).toBe(true);
    expect(insertNativeText).toHaveBeenCalledWith('첫 셀\t둘째 셀');
    expect(mocks.readText).not.toHaveBeenCalled();
  });
});
