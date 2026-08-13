import { describe, expect, it } from 'vitest';
import { buildScopedAlignedChunks } from '@/ai/tools/reviewTool';

const p = (text: string, id?: string) => ({
  type: 'paragraph',
  ...(id ? { attrs: { translationUnitId: id } } : {}),
  content: [{ type: 'text', text }],
});
const cell = (text: string, id?: string, innerId?: string) => ({
  type: 'tableCell',
  ...(id ? { attrs: { translationUnitId: id } } : {}),
  content: [
    {
      type: 'paragraph',
      ...(innerId ? { attrs: { translationUnitId: innerId } } : {}),
      content: text ? [{ type: 'text', text }] : [],
    },
  ],
});
const table = (...cells: unknown[]) => ({
  type: 'table',
  content: [{ type: 'tableRow', content: cells }],
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('buildScopedAlignedChunks', () => {
  const sourceDoc = doc(p('First source.'), p('Second source.'), p('Third source.'));
  const targetDoc = doc(
    p('첫 번째 번역.', 'u1'),
    p('두 번째 번역.', 'u2'),
    p('세 번째 번역.', 'u3'),
  );

  it('선택한 유닛의 원문↔번역문 쌍만 세그먼트로 만든다', () => {
    const chunks = buildScopedAlignedChunks({
      sourceDocJson: sourceDoc,
      targetDocJson: targetDoc,
      targetUnitIds: ['u2'],
    });

    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(1);
    expect(chunks?.[0]?.segments).toEqual([
      {
        groupId: 'scoped-0',
        order: 0,
        sourceText: 'Second source.',
        targetText: '두 번째 번역.',
      },
    ]);
  });

  it('여러 유닛 선택은 문서 순서대로 세그먼트를 만든다', () => {
    const chunks = buildScopedAlignedChunks({
      sourceDocJson: sourceDoc,
      targetDocJson: targetDoc,
      targetUnitIds: ['u3', 'u1'],
    });

    expect(chunks?.[0]?.segments.map((s) => s.sourceText)).toEqual([
      'First source.',
      'Third source.',
    ]);
    expect(chunks?.[0]?.segments.map((s) => s.groupId)).toEqual(['scoped-0', 'scoped-1']);
    expect(chunks?.[0]?.segments.map((s) => s.order)).toEqual([0, 1]);
  });

  it('선택 유닛 하나라도 원문 대응이 없으면 null (fail-closed)', () => {
    // 원문이 두 문단뿐이라 세 번째 번역 유닛은 짝이 없다
    const shortSource = doc(p('First source.'), p('Second source.'));

    expect(
      buildScopedAlignedChunks({
        sourceDocJson: shortSource,
        targetDocJson: targetDoc,
        targetUnitIds: ['u1', 'u3'],
      }),
    ).toBeNull();
  });

  it('알 수 없는 유닛 ID만 주면 null', () => {
    expect(
      buildScopedAlignedChunks({
        sourceDocJson: sourceDoc,
        targetDocJson: targetDoc,
        targetUnitIds: ['nope'],
      }),
    ).toBeNull();
  });

  it('빈 선택은 null', () => {
    expect(
      buildScopedAlignedChunks({
        sourceDocJson: sourceDoc,
        targetDocJson: targetDoc,
        targetUnitIds: [],
      }),
    ).toBeNull();
  });

  it('표 셀 선택은 셀과 내부 문단이 중복 세그먼트가 되지 않는다', () => {
    const source = doc(p('Intro.'), table(cell('Cell source.')));
    const target = doc(p('도입.', 't1'), table(cell('셀 번역.', 'c1', 'c1p')));

    const chunks = buildScopedAlignedChunks({
      sourceDocJson: source,
      targetDocJson: target,
      // 셀 안을 선택하면 tableCell ID와 내부 paragraph ID가 함께 잡힌다
      targetUnitIds: ['c1', 'c1p'],
    });

    expect(chunks?.[0]?.segments).toEqual([
      {
        groupId: 'scoped-0',
        order: 0,
        sourceText: 'Cell source.',
        targetText: '셀 번역.',
      },
    ]);
  });

  it('빈 유닛만 선택하면 null', () => {
    const source = doc(p('First source.'), p('Second source.'));
    const target = doc(p('첫 번역.', 'u1'), p('', 'empty'));

    expect(
      buildScopedAlignedChunks({
        sourceDocJson: source,
        targetDocJson: target,
        targetUnitIds: ['empty'],
      }),
    ).toBeNull();
  });

  it('상한을 넘으면 청크를 나눈다', () => {
    const long = 'x'.repeat(400);
    const source = doc(p(`${long}1`), p(`${long}2`), p(`${long}3`));
    const target = doc(p(`${long}가`, 'u1'), p(`${long}나`, 'u2'), p(`${long}다`, 'u3'));

    const chunks = buildScopedAlignedChunks({
      sourceDocJson: source,
      targetDocJson: target,
      targetUnitIds: ['u1', 'u2', 'u3'],
      // 세그먼트 하나가 ~802자 → 두 개까지만 한 청크에 들어간다
      maxCharsPerChunk: 1_700,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks?.[0]?.segments).toHaveLength(2);
    expect(chunks?.[1]?.segments).toHaveLength(1);
    expect(chunks?.[1]?.chunkIndex).toBe(1);
    // groupId는 청크를 가로질러 유일해야 한다 (역인덱싱이 런 전체 세그먼트 기준)
    expect(chunks?.[1]?.segments[0]?.groupId).toBe('scoped-2');
  });
});
