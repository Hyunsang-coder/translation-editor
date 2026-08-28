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

  it('표에서 고른 셀만 세그먼트로 남기고 사이 셀은 빼지 않는다', () => {
    const source = doc(
      table(cell('Alpha source.'), cell('Skip source.'), cell('Gamma source.')),
    );
    const target = doc(
      table(
        cell('알파 번역.', 'c1', 'c1p'),
        cell('건너뛸 번역.', 'c2', 'c2p'),
        cell('감마 번역.', 'c3', 'c3p'),
      ),
    );

    const chunks = buildScopedAlignedChunks({
      sourceDocJson: source,
      targetDocJson: target,
      // 1열과 3열만 고른 선택 — 2열 유닛은 요청에 없다
      targetUnitIds: ['c1', 'c1p', 'c3', 'c3p'],
    });

    expect(chunks?.[0]?.segments.map((s) => s.sourceText)).toEqual([
      'Alpha source.',
      'Gamma source.',
    ]);
    expect(chunks?.[0]?.segments.map((s) => s.targetText)).toEqual([
      '알파 번역.',
      '감마 번역.',
    ]);
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

  describe('부분 번역과 같은 짝짓기 규칙을 쓴다', () => {
    const pid = (text: string, id: string) => p(text, id);

    it('ID가 공유된 문서는 구조가 어긋나도 ID로 짝짓는다', () => {
      // 번역가가 번역문 heading 레벨을 바꾼 문서. 시그니처(h1↔h2)가 달라 LCS는
      // 짝을 잃지만, 전체 번역으로 ID가 이어져 있으면 대응은 확실하다.
      const source = doc(
        { type: 'heading', attrs: { level: 1, translationUnitId: 'u1' }, content: [{ type: 'text', text: 'Title' }] },
        pid('Body.', 'u2'),
      );
      const target = doc(
        { type: 'heading', attrs: { level: 2, translationUnitId: 'u1' }, content: [{ type: 'text', text: '제목' }] },
        pid('본문.', 'u2'),
      );

      const chunks = buildScopedAlignedChunks({
        sourceDocJson: source,
        targetDocJson: target,
        targetUnitIds: ['u1'],
      });

      expect(chunks?.[0]?.segments).toEqual([
        { groupId: 'scoped-0', order: 0, sourceText: 'Title', targetText: '제목' },
      ]);
    });

    it('LCS 상한을 넘어도 전체 1:1이면 순번 짝짓기를 신뢰한다', () => {
      // 501 × 501 = 251,001 > LCS_CELL_LIMIT(250,000).
      // 정렬 검사에는 불일치 0으로 보이는데 범위 검수만 거부하던 케이스.
      const big = (prefix: string, count: number) =>
        doc(...Array.from({ length: count }, (_, i) => pid(`${prefix} ${i}`, `${prefix}-${i}`)));

      const chunks = buildScopedAlignedChunks({
        sourceDocJson: big('s', 501),
        targetDocJson: big('t', 501),
        targetUnitIds: ['t-250'],
      });

      expect(chunks?.[0]?.segments).toEqual([
        { groupId: 'scoped-0', order: 0, sourceText: 's 250', targetText: 't 250' },
      ]);
    });

    it('ID는 이어져 있어도 원문 유닛이 비어 있으면 null', () => {
      const source = doc(pid('Intro.', 'u1'), { type: 'paragraph', attrs: { translationUnitId: 'u2' } });
      const target = doc(pid('도입.', 'u1'), pid('원문에 없는 문단.', 'u2'));

      expect(
        buildScopedAlignedChunks({
          sourceDocJson: source,
          targetDocJson: target,
          targetUnitIds: ['u2'],
        }),
      ).toBeNull();
    });

    it('LCS 상한을 넘고 1:1도 아니면 여전히 null', () => {
      const big = (prefix: string, count: number) =>
        doc(...Array.from({ length: count }, (_, i) => pid(`${prefix} ${i}`, `${prefix}-${i}`)));

      expect(
        buildScopedAlignedChunks({
          sourceDocJson: big('s', 502),
          targetDocJson: big('t', 501),
          targetUnitIds: ['t-250'],
        }),
      ).toBeNull();
    });
  });
});
