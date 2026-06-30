import { describe, it, expect } from 'vitest';
import { extractClipboardImageFromDataTransfer } from './clipboardImage';

function mockDataTransfer(partial: {
  items?: DataTransferItem[];
  files?: FileList | File[];
}): DataTransfer {
  return partial as unknown as DataTransfer;
}

function mockClipboardItem(type: string, file: File | null): DataTransferItem {
  return {
    kind: 'file',
    type,
    getAsFile: () => file,
  } as DataTransferItem;
}

describe('extractClipboardImageFromDataTransfer', () => {
  it('returns null when dataTransfer is null', () => {
    expect(extractClipboardImageFromDataTransfer(null)).toBeNull();
  });

  it('extracts image from clipboard items', () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
    const dt = mockDataTransfer({
      items: [mockClipboardItem('image/png', file)],
    });

    const result = extractClipboardImageFromDataTransfer(dt);

    expect(result).not.toBeNull();
    expect(result?.blob).toBe(file);
    expect(result?.filename).toMatch(/^clipboard-\d+\.png$/);
  });

  it('extracts image from clipboard files fallback', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'capture.jpeg', { type: 'image/jpeg' });
    const dt = mockDataTransfer({ files: [file] });

    const result = extractClipboardImageFromDataTransfer(dt);

    expect(result).not.toBeNull();
    expect(result?.filename).toBe('capture.jpeg');
  });

  it('returns null for text-only clipboard', () => {
    const dt = mockDataTransfer({ items: [], files: [] });

    expect(extractClipboardImageFromDataTransfer(dt)).toBeNull();
  });
});
