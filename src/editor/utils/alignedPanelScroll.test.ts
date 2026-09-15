import { describe, expect, it } from 'vitest';
import {
  buildAlignedUnitMaps,
  resolveCounterpartScrollTop,
} from './alignedPanelScroll';

function doc(...units: Array<{
  id: string;
  text: string;
  type?: 'paragraph' | 'heading';
  level?: number;
}>) {
  return {
    type: 'doc',
    content: units.map(({ id, text, type = 'paragraph', level }) => ({
      type,
      attrs: {
        translationUnitId: id,
        ...(type === 'heading' ? { level: level ?? 2 } : {}),
      },
      content: [{ type: 'text', text }],
    })),
  };
}

describe('buildAlignedUnitMaps', () => {
  it('prefers matching unique translation unit IDs', () => {
    const maps = buildAlignedUnitMaps(
      doc(
        { id: 'shared-1', text: 'Source one' },
        { id: 'shared-2', text: 'Source two' },
      ),
      doc(
        { id: 'shared-1', text: '번역 하나' },
        { id: 'shared-2', text: '번역 둘' },
      ),
    );

    expect(maps.sourceToTarget).toEqual(
      new Map([
        ['shared-1', 'shared-1'],
        ['shared-2', 'shared-2'],
      ]),
    );
    expect(maps.targetToSource).toEqual(
      new Map([
        ['shared-1', 'shared-1'],
        ['shared-2', 'shared-2'],
      ]),
    );
  });

  it('falls back to structural alignment for legacy documents with distinct IDs', () => {
    const maps = buildAlignedUnitMaps(
      doc(
        { id: 'source-1', text: 'Source one' },
        { id: 'source-2', text: 'Source two' },
      ),
      doc(
        { id: 'target-1', text: '번역 하나' },
        { id: 'target-2', text: '번역 둘' },
      ),
    );

    expect(maps.sourceToTarget).toEqual(
      new Map([
        ['source-1', 'target-1'],
        ['source-2', 'target-2'],
      ]),
    );
  });

  it('does not map an unmatched paragraph in the middle', () => {
    const maps = buildAlignedUnitMaps(
      doc(
        { id: 'source-title', text: 'Source title', type: 'heading', level: 2 },
        { id: 'source-1', text: 'Source one' },
        { id: 'source-next', text: 'Next title', type: 'heading', level: 3 },
      ),
      doc(
        { id: 'target-title', text: '번역 제목', type: 'heading', level: 2 },
        { id: 'target-1', text: '번역 하나' },
        { id: 'target-extra', text: '추가 제목', type: 'heading', level: 4 },
        { id: 'target-next', text: '다음 제목', type: 'heading', level: 3 },
      ),
    );

    expect(maps.sourceToTarget.get('source-1')).toBe('target-1');
    expect(maps.sourceToTarget.get('source-next')).toBe('target-next');
    expect(maps.targetToSource.has('target-extra')).toBe(false);
  });

  it('fails closed for duplicated IDs', () => {
    const maps = buildAlignedUnitMaps(
      doc(
        { id: 'duplicate', text: 'Source one' },
        { id: 'duplicate', text: 'Source two' },
      ),
      doc(
        { id: 'target-1', text: '번역 하나' },
        { id: 'target-2', text: '번역 둘' },
      ),
    );

    expect(maps.sourceToTarget.has('duplicate')).toBe(false);
    expect(maps.targetToSource.size).toBe(0);
  });
});

describe('resolveCounterpartScrollTop', () => {
  const base = {
    counterpartTop: 400,
    counterpartContainerTop: 100,
    counterpartScrollTop: 200,
    counterpartScrollHeight: 2_000,
    counterpartClientHeight: 500,
    primaryViewportOffset: 40,
  };

  it('keeps the anchor at the primary panel viewport offset', () => {
    expect(resolveCounterpartScrollTop({ ...base, zoom: 1 })).toBe(460);
  });

  it('converts screen-coordinate deltas for CSS zoom', () => {
    expect(resolveCounterpartScrollTop({ ...base, zoom: 2 })).toBe(330);
    expect(resolveCounterpartScrollTop({ ...base, zoom: 0.5 })).toBe(720);
  });

  it('clamps to the scrollable range', () => {
    expect(resolveCounterpartScrollTop({
      ...base,
      counterpartTop: -10_000,
      zoom: 1,
    })).toBe(0);

    expect(resolveCounterpartScrollTop({
      ...base,
      counterpartTop: 10_000,
      zoom: 1,
    })).toBe(1_500);
  });

  it('does not schedule an imperceptible movement', () => {
    expect(resolveCounterpartScrollTop({
      ...base,
      counterpartTop: 140.5,
      zoom: 1,
    })).toBeNull();
  });
});
