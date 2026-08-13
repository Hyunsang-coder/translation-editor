import { describe, expect, it } from 'vitest';
import {
  dropAncestorUnits,
  ensureTranslationUnitIds,
  type TranslationUnitDocument,
} from '@/editor/extensions/TranslationUnitId';
import { findAlignedCounterpartUnits } from './alignedCounterpartUnits';

describe('findAlignedCounterpartUnits', () => {
  const sourceDoc = ensureTranslationUnitIds({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
    ],
  }, (() => {
    let index = 0;
    return () => `source-${++index}`;
  })());

  it('translationUnitId가 일치하면 ID로 반대쪽 유닛을 찾는다', () => {
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, translationUnitId: 'source-1' }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'source-2' }, content: [{ type: 'text', text: '본문' }] },
      ],
    };

    const units = findAlignedCounterpartUnits(sourceDoc, targetDoc, ['source-2']);

    expect(units.map((unit) => unit.text)).toEqual(['Body']);
  });

  it('ID가 독립 발급된 legacy 문서는 LCS 정렬로 짝짓는다', () => {
    // legacy 프로젝트: Target 에디터가 독립적으로 부여한 랜덤 ID
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
      ],
    };

    const units = findAlignedCounterpartUnits(sourceDoc, targetDoc, ['random-b']);

    expect(units.map((unit) => unit.text)).toEqual(['Body']);
  });

  it('빈 문단 개수가 달라도 내용 유닛으로 짝짓는다', () => {
    // 실제 번역 문서에서 관찰된 케이스: Target에만 빈 문단이 더 있음
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 'random-0' } },
        { type: 'heading', attrs: { level: 1, translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'random-c' } },
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
      ],
    };

    const units = findAlignedCounterpartUnits(sourceDoc, targetDoc, ['random-b']);

    expect(units.map((unit) => unit.text)).toEqual(['Body']);
  });

  // 예전 순번 fallback은 "문서 전체가 1:1"을 요구해 legacy 문서에서 원문에 문단
  // 하나만 추가·분할해도 문서 전체의 대응이 죽었다. LCS는 짝을 잃은 유닛만 실패한다.
  it('원문에 문단이 추가돼도 나머지 문단은 짝지어진다', () => {
    const grownSourceDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, translationUnitId: 's1' }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', attrs: { translationUnitId: 's2' }, content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', attrs: { translationUnitId: 's3' }, content: [{ type: 'text', text: 'Added' }] },
        { type: 'paragraph', attrs: { translationUnitId: 's4' }, content: [{ type: 'text', text: 'Two' }] },
      ],
    };
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, translationUnitId: 't1' }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', attrs: { translationUnitId: 't2' }, content: [{ type: 'text', text: '하나' }] },
        { type: 'paragraph', attrs: { translationUnitId: 't3' }, content: [{ type: 'text', text: '둘' }] },
      ],
    };

    expect(
      findAlignedCounterpartUnits(grownSourceDoc, targetDoc, ['t3'])
        .map((unit) => unit.text),
    ).toEqual(['Two']);
    expect(
      findAlignedCounterpartUnits(grownSourceDoc, targetDoc, ['t1'])
        .map((unit) => unit.text),
    ).toEqual(['Title']);
  });

  it('원문 문단이 분할돼도 나머지 문단은 짝지어진다', () => {
    const splitSourceDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 's1' }, content: [{ type: 'text', text: 'First half.' }] },
        { type: 'paragraph', attrs: { translationUnitId: 's2' }, content: [{ type: 'text', text: 'Second half.' }] },
        { type: 'paragraph', attrs: { translationUnitId: 's3' }, content: [{ type: 'text', text: 'Next' }] },
      ],
    };
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 't1' }, content: [{ type: 'text', text: '원래' }] },
        { type: 'paragraph', attrs: { translationUnitId: 't2' }, content: [{ type: 'text', text: '다음' }] },
      ],
    };

    expect(
      findAlignedCounterpartUnits(splitSourceDoc, targetDoc, ['t2'])
        .map((unit) => unit.text),
    ).toEqual(['Next']);
  });

  it('반대쪽에 짝이 없는 유닛을 선택하면 추측하지 않는다', () => {
    // Target에만 있는 heading — LCS가 target-only로 남긴다
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, translationUnitId: 'extra' }, content: [{ type: 'text', text: '메모' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
      ],
    };
    const plainSourceDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 's1' }, content: [{ type: 'text', text: 'Body' }] },
      ],
    };

    expect(findAlignedCounterpartUnits(plainSourceDoc, targetDoc, ['extra'])).toEqual([]);
    // 짝 없는 유닛이 선택에 섞여 있으면 부분 결과 대신 전체 실패
    expect(
      findAlignedCounterpartUnits(plainSourceDoc, targetDoc, ['extra', 'random-b']),
    ).toEqual([]);
  });

  it('문단 순서가 뒤바뀐 문서에서 잘못 짝짓지 않는다', () => {
    const swappedTargetDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
        { type: 'heading', attrs: { level: 1, translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목' }] },
      ],
    };

    expect(findAlignedCounterpartUnits(sourceDoc, swappedTargetDoc, ['random-a'])).toEqual([]);
    expect(
      findAlignedCounterpartUnits(sourceDoc, swappedTargetDoc, ['random-b'])
        .map((unit) => unit.text),
    ).toEqual(['Body']);
  });

  it('heading 레벨이 다르면 그 유닛만 실패하고 나머지는 짝지어진다', () => {
    // 정렬 뷰와 같은 판단: h1↔h2는 불일치, 문단은 짝지어진다
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, translationUnitId: 'random-a' }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
      ],
    };

    expect(findAlignedCounterpartUnits(sourceDoc, targetDoc, ['random-a'])).toEqual([]);
    expect(
      findAlignedCounterpartUnits(sourceDoc, targetDoc, ['random-b'])
        .map((unit) => unit.text),
    ).toEqual(['Body']);
  });

  it('선택 ID 일부만 ID로 일치하면 부분 결과를 반환하지 않는다', () => {
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, translationUnitId: 'source-1' }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '본문' }] },
      ],
    };

    expect(
      findAlignedCounterpartUnits(sourceDoc, targetDoc, ['source-1', 'random-b']),
    ).toEqual([]);
  });

  it('같은 ID가 복제돼 있으면(과거 분할 이력) 해당 유닛을 모두 반환한다', () => {
    // keepOnSplit 수정 전에 저장된 문서: 분할된 두 반쪽이 같은 ID를 가진다
    const splitSourceDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 'dup' }, content: [{ type: 'text', text: 'First half.' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'dup' }, content: [{ type: 'text', text: 'Second half.' }] },
      ],
    };
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 'dup' }, content: [{ type: 'text', text: '번역' }] },
      ],
    };

    const units = findAlignedCounterpartUnits(splitSourceDoc, targetDoc, ['dup']);

    expect(units.map((unit) => unit.text)).toEqual(['First half.', 'Second half.']);
  });

  it('중복 ID가 있어도 선택 ID 일부가 반대쪽에 없으면 빈 배열을 반환한다', () => {
    const splitSourceDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 'dup' }, content: [{ type: 'text', text: 'First half.' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'dup' }, content: [{ type: 'text', text: 'Second half.' }] },
      ],
    };
    const targetDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { translationUnitId: 'dup' }, content: [{ type: 'text', text: '번역' }] },
        { type: 'paragraph', attrs: { translationUnitId: 'random-b' }, content: [{ type: 'text', text: '추가 문단' }] },
      ],
    };

    expect(
      findAlignedCounterpartUnits(splitSourceDoc, targetDoc, ['dup', 'random-b']),
    ).toEqual([]);
  });

  describe('LCS 상한 초과 (degraded 순번 폴백)', () => {
    const bigDoc = (prefix: string, count: number) => ({
      type: 'doc',
      content: Array.from({ length: count }, (_, index) => ({
        type: 'paragraph',
        attrs: { translationUnitId: `${prefix}-${index}` },
        content: [{ type: 'text', text: `${prefix} ${index}` }],
      })),
    });

    it('전체 1:1이면 순번 짝짓기를 신뢰한다', () => {
      // 501 × 501 = 251,001 > LCS_CELL_LIMIT(250,000)
      const units = findAlignedCounterpartUnits(bigDoc('s', 501), bigDoc('t', 501), ['t-250']);

      expect(units.map((unit) => unit.text)).toEqual(['s 250']);
    });

    it('1:1이 아니면 시그니처 검증 없는 순번 짝짓기를 신뢰하지 않는다', () => {
      expect(
        findAlignedCounterpartUnits(bigDoc('s', 502), bigDoc('t', 501), ['t-250']),
      ).toEqual([]);
    });
  });

  it('표 셀과 안쪽 문단 ID가 함께 잡혀도 안쪽 원문만 짝짓는다', () => {
    const cell = (text: string, id?: string, innerId?: string) => ({
      type: 'tableCell',
      ...(id ? { attrs: { translationUnitId: id } } : {}),
      content: [{
        type: 'paragraph',
        ...(innerId ? { attrs: { translationUnitId: innerId } } : {}),
        content: [{ type: 'text', text }],
      }],
    });
    const table = (...cells: TranslationUnitDocument[]) => ({
      type: 'table',
      content: [{ type: 'tableRow', content: cells }],
    });
    const sourceDoc = {
      type: 'doc',
      content: [table(cell('Alpha source.', 's1', 's1p'), cell('Beta source.', 's2', 's2p'))],
    };
    const targetDoc = {
      type: 'doc',
      content: [table(cell('알파 번역.', 't1', 't1p'), cell('베타 번역.', 't2', 't2p'))],
    };

    const units = dropAncestorUnits(
      findAlignedCounterpartUnits(sourceDoc, targetDoc, ['t1', 't1p']),
    );

    expect(units.map((unit) => unit.text)).toEqual(['Alpha source.']);
  });
});
