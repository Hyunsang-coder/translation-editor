import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import {
  buildDocSearchIndex,
  buildTextWithPositions,
  filterMatchesInRange,
  findSegmentRange,
  type SearchMatch,
} from './SearchHighlight';

describe('filterMatchesInRange', () => {
  it('범위 내의 매치만 반환한다', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 20 },
      { from: 50, to: 60 },
      { from: 100, to: 110 },
    ];
    const range = { from: 40, to: 70 };

    const result = filterMatchesInRange(matches, range);

    expect(result).toEqual([{ from: 50, to: 60 }]);
  });

  it('범위 경계에 걸친 매치는 제외한다', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 25 }, // 시작점이 범위 밖
      { from: 20, to: 30 }, // 시작점이 범위 내, 끝점이 범위 내
      { from: 25, to: 35 }, // 끝점이 범위 밖
    ];
    const range = { from: 20, to: 30 };

    const result = filterMatchesInRange(matches, range);

    expect(result).toEqual([{ from: 20, to: 30 }]);
  });

  it('범위와 정확히 일치하는 매치를 포함한다', () => {
    const matches: SearchMatch[] = [{ from: 50, to: 60 }];
    const range = { from: 50, to: 60 };

    const result = filterMatchesInRange(matches, range);

    expect(result).toEqual([{ from: 50, to: 60 }]);
  });

  it('빈 매치 배열을 처리한다', () => {
    const matches: SearchMatch[] = [];
    const range = { from: 0, to: 100 };

    const result = filterMatchesInRange(matches, range);

    expect(result).toEqual([]);
  });

  it('모든 매치가 범위 밖이면 빈 배열을 반환한다', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 20 },
      { from: 80, to: 90 },
    ];
    const range = { from: 30, to: 70 };

    const result = filterMatchesInRange(matches, range);

    expect(result).toEqual([]);
  });
});

describe('buildDocSearchIndex (P2: 단일 순회 인덱스)', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      text: { group: 'inline' },
      paragraph: {
        group: 'block',
        content: 'inline*',
        attrs: {
          segmentGroupId: { default: null },
        },
      },
    },
  });

  it('text/positions가 buildTextWithPositions와 동일하다', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', { segmentGroupId: 'seg-1' }, schema.text('Hello world')),
      schema.node('paragraph', { segmentGroupId: 'seg-2' }, schema.text('두 번째 문단')),
    ]);

    const index = buildDocSearchIndex(doc);
    const legacy = buildTextWithPositions(doc);

    expect(index.text).toBe(legacy.text);
    expect(index.positions).toEqual(legacy.positions);
  });

  it('segmentRanges가 findSegmentRange와 동일한 범위를 반환한다', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', { segmentGroupId: 'seg-1' }, schema.text('Hello world')),
      schema.node('paragraph', { segmentGroupId: 'seg-2' }, schema.text('Second paragraph')),
    ]);

    const { segmentRanges } = buildDocSearchIndex(doc);

    expect(segmentRanges.size).toBe(2);
    expect(segmentRanges.get('seg-1')).toEqual(findSegmentRange(doc, 'seg-1'));
    expect(segmentRanges.get('seg-2')).toEqual(findSegmentRange(doc, 'seg-2'));
  });

  it('같은 segmentGroupId가 여러 블록에 걸치면 min from~max to로 병합한다', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', { segmentGroupId: 'seg-x' }, schema.text('첫 블록')),
      schema.node('paragraph', { segmentGroupId: 'other' }, schema.text('중간 블록')),
      schema.node('paragraph', { segmentGroupId: 'seg-x' }, schema.text('마지막 블록')),
    ]);

    const { segmentRanges } = buildDocSearchIndex(doc);

    expect(segmentRanges.get('seg-x')).toEqual(findSegmentRange(doc, 'seg-x'));
  });

  it('segmentGroupId가 없는 문서는 빈 맵을 반환한다', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('일반 문단')),
    ]);

    const { segmentRanges } = buildDocSearchIndex(doc);

    expect(segmentRanges.size).toBe(0);
  });
});
