import { describe, expect, it } from 'vitest';
import {
  getAlignedSelectionContext,
  getSelectionSurroundings,
} from './selectionTools';

const sourceDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { translationUnitId: 'u1' }, content: [{ type: 'text', text: 'Before' }] },
    { type: 'paragraph', attrs: { translationUnitId: 'u2' }, content: [{ type: 'text', text: 'Selected source' }] },
    { type: 'paragraph', attrs: { translationUnitId: 'u3' }, content: [{ type: 'text', text: 'After' }] },
  ],
};

const targetDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { translationUnitId: 'u1' }, content: [{ type: 'text', text: '이전' }] },
    { type: 'paragraph', attrs: { translationUnitId: 'u2' }, content: [{ type: 'text', text: '선택 번역' }] },
    { type: 'paragraph', attrs: { translationUnitId: 'u3' }, content: [{ type: 'text', text: '이후' }] },
  ],
};

describe('selection tools', () => {
  it('선택 단위 주변을 제한된 개수만 반환한다', () => {
    expect(getSelectionSurroundings(targetDoc, ['u2'], 1, 1)).toEqual({
      selected: ['선택 번역'],
      before: ['이전'],
      after: ['이후'],
      unitIds: ['u1', 'u2', 'u3'],
      truncated: false,
    });
  });

  it('Target ID로 연결된 Source/Target을 반환한다', () => {
    expect(getAlignedSelectionContext(sourceDoc, targetDoc, ['u2'], 0, 0))
      .toMatchObject({
        source: 'Selected source',
        target: '선택 번역',
        unitIds: ['u2'],
        truncated: false,
      });
  });

  it('연결 ID가 없으면 임의 텍스트 매칭을 하지 않는다', () => {
    expect(() =>
      getAlignedSelectionContext(sourceDoc, targetDoc, ['missing'], 0, 0),
    ).toThrow('연결된 원문');
  });
});
