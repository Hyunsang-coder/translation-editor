import { describe, expect, it } from 'vitest';
import { appendTopLevelBlocks, replaceTopLevelBlockRange } from './topLevelBlockSplice';

const paragraph = (text: string, unitId?: string) => ({
  type: 'paragraph',
  ...(unitId ? { attrs: { translationUnitId: unitId } } : {}),
  content: [{ type: 'text', text }],
});

describe('appendTopLevelBlocks', () => {
  it('base 뒤에 added의 최상위 블록을 이어 붙인다', () => {
    const base = { type: 'doc', content: [paragraph('A'), paragraph('B')] };
    const added = { type: 'doc', content: [paragraph('C')] };

    const merged = appendTopLevelBlocks(base, added);

    expect((merged.content as unknown[]).length).toBe(3);
    expect(merged).toEqual({
      type: 'doc',
      content: [paragraph('A'), paragraph('B'), paragraph('C')],
    });
  });

  it('입력을 변형하지 않는다', () => {
    const base = { type: 'doc', content: [paragraph('A')] };
    const added = { type: 'doc', content: [paragraph('B')] };
    const baseSnapshot = JSON.parse(JSON.stringify(base));
    const addedSnapshot = JSON.parse(JSON.stringify(added));

    appendTopLevelBlocks(base, added);

    expect(base).toEqual(baseSnapshot);
    expect(added).toEqual(addedSnapshot);
  });

  it('attrs(translationUnitId)를 보존한다', () => {
    const base = { type: 'doc', content: [paragraph('A', 'unit-a')] };
    const added = { type: 'doc', content: [paragraph('B', 'unit-b')] };

    const merged = appendTopLevelBlocks(base, added);
    const blocks = merged.content as Array<{ attrs?: { translationUnitId?: string } }>;

    expect(blocks[0]?.attrs?.translationUnitId).toBe('unit-a');
    expect(blocks[1]?.attrs?.translationUnitId).toBe('unit-b');
  });

  it('content가 없는 문서도 빈 배열로 다룬다', () => {
    expect(appendTopLevelBlocks({ type: 'doc' }, { type: 'doc', content: [paragraph('A')] })).toEqual({
      type: 'doc',
      content: [paragraph('A')],
    });
    expect(appendTopLevelBlocks({ type: 'doc', content: [paragraph('A')] }, { type: 'doc' })).toEqual({
      type: 'doc',
      content: [paragraph('A')],
    });
  });
});

describe('replaceTopLevelBlockRange', () => {
  const base = {
    type: 'doc',
    content: [paragraph('A', 'u1'), paragraph('B', 'u2'), paragraph('C', 'u3'), paragraph('D', 'u4')],
  };

  it('구간을 replacement 블록들로 치환한다 (양끝 포함)', () => {
    const merged = replaceTopLevelBlockRange(base, 1, 2, {
      type: 'doc',
      content: [paragraph('B+'), paragraph('C+')],
    });

    expect(merged).toEqual({
      type: 'doc',
      content: [paragraph('A', 'u1'), paragraph('B+'), paragraph('C+'), paragraph('D', 'u4')],
    });
  });

  it('블록 수가 다른 replacement도 받는다', () => {
    const merged = replaceTopLevelBlockRange(base, 1, 2, {
      type: 'doc',
      content: [paragraph('BC')],
    });

    expect((merged.content as unknown[]).length).toBe(3);
  });

  it('구간 밖 블록의 attrs를 보존하고 입력을 변형하지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(base));

    const merged = replaceTopLevelBlockRange(base, 1, 1, { type: 'doc', content: [paragraph('B+')] });
    const blocks = merged.content as Array<{ attrs?: { translationUnitId?: string } }>;

    expect(blocks[0]?.attrs?.translationUnitId).toBe('u1');
    expect(blocks[3]?.attrs?.translationUnitId).toBe('u4');
    expect(base).toEqual(snapshot);
  });

  it('문서 밖 범위는 조용히 자르지 않고 던진다', () => {
    const replacement = { type: 'doc', content: [paragraph('X')] };

    expect(() => replaceTopLevelBlockRange(base, 2, 9, replacement)).toThrow();
    expect(() => replaceTopLevelBlockRange(base, -1, 1, replacement)).toThrow();
    expect(() => replaceTopLevelBlockRange(base, 2, 1, replacement)).toThrow();
  });
});
