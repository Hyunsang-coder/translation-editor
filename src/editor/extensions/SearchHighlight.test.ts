import { describe, it, expect } from 'vitest';
import { filterMatchesInRange, type SearchMatch } from './SearchHighlight';

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
