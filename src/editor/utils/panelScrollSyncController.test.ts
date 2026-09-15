import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPanelScrollSyncSuppressed,
  withPanelScrollSyncSuppressed,
} from './panelScrollSyncController';

describe('panel scroll sync suppression', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps synchronization suppressed through two animation frames', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    withPanelScrollSyncSuppressed(() => {
      expect(isPanelScrollSyncSuppressed()).toBe(true);
    });

    expect(isPanelScrollSyncSuppressed()).toBe(true);
    frames.shift()?.(0);
    expect(isPanelScrollSyncSuppressed()).toBe(true);
    frames.shift()?.(16);
    expect(isPanelScrollSyncSuppressed()).toBe(false);
  });

  it('keeps nested suppressions independent', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    withPanelScrollSyncSuppressed(() => {
      withPanelScrollSyncSuppressed(() => undefined);
    });

    frames.shift()?.(0);
    frames.shift()?.(16);
    expect(isPanelScrollSyncSuppressed()).toBe(true);

    frames.shift()?.(32);
    frames.shift()?.(48);
    expect(isPanelScrollSyncSuppressed()).toBe(false);
  });
});
