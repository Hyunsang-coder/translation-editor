import { describe, it, expect } from 'vitest';
import type { SearchMatch } from '@/editor/extensions/SearchHighlight';
import { filterMatchesBySegment } from './reviewApply';
import { normalizeSegmentGroupId } from './reviewApply';

describe('filterMatchesBySegment', () => {
  it('segment 범위가 없고 매치가 하나면 유지한다 (segmentGroupId 존재)', () => {
    const matches: SearchMatch[] = [{ from: 10, to: 20 }];

    const result = filterMatchesBySegment(matches, null, true, true);

    expect(result).toEqual(matches);
  });

  it('segment 범위 밖 매치는 제거한다', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 20 },
      { from: 40, to: 50 },
    ];
    const range = { from: 30, to: 60 };

    const result = filterMatchesBySegment(matches, range, true, true);

    expect(result).toEqual([{ from: 40, to: 50 }]);
  });

  it('segmentGroupId가 없으면 범위 필터를 적용하지 않는다', () => {
    const matches: SearchMatch[] = [{ from: 10, to: 20 }];

    const result = filterMatchesBySegment(matches, { from: 30, to: 60 }, false, true);

    expect(result).toEqual(matches);
  });

  it('segment 범위가 없고 문서에 segmentGroupId가 없으면 매치를 유지한다', () => {
    const matches: SearchMatch[] = [{ from: 10, to: 20 }];

    const result = filterMatchesBySegment(matches, null, true, false);

    expect(result).toEqual(matches);
  });

  it('segment 범위가 없고 매치가 여러 개면 제거한다 (문서에 segmentGroupId 존재)', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 20 },
      { from: 30, to: 40 },
    ];

    const result = filterMatchesBySegment(matches, null, true, true);

    expect(result).toEqual([]);
  });
});

describe('normalizeSegmentGroupId', () => {
  it('leading # 제거', () => {
    expect(normalizeSegmentGroupId('#0')).toBe('0');
  });

  it('값이 없으면 undefined', () => {
    expect(normalizeSegmentGroupId(undefined)).toBeUndefined();
  });

  it('그 외는 그대로 반환', () => {
    expect(normalizeSegmentGroupId('seg-1')).toBe('seg-1');
  });
});
