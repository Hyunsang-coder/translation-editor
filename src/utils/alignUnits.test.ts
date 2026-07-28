import { describe, expect, it } from 'vitest';
import type { TranslationUnitDocument } from '@/editor/extensions/TranslationUnitId';
import { alignUnits } from './alignUnits';

const para = (text: string): TranslationUnitDocument => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const heading = (level: number, text: string): TranslationUnitDocument => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

const doc = (...content: TranslationUnitDocument[]): TranslationUnitDocument => ({
  type: 'doc',
  content,
});

const repeatParas = (count: number, prefix: string): TranslationUnitDocument[] =>
  Array.from({ length: count }, (_, i) => para(`${prefix}${i}`));

describe('alignUnits', () => {
  it('동일 구조 5:5는 전부 짝이 맞는다', () => {
    const result = alignUnits(
      doc(...repeatParas(5, 'src')),
      doc(...repeatParas(5, 'tgt')),
    );

    expect(result.ops.filter((op) => op.kind === 'pair')).toHaveLength(5);
    expect(result.pairedCount).toBe(5);
    expect(result.mismatchCount).toBe(0);
    expect(result.totalUnits).toBe(5);
    expect(result.ratio).toBe(1);
    expect(result.degraded).toBe(false);
  });

  it('번역문에 문단이 1개 추가되면 target-only 1개가 된다 (5:6)', () => {
    const result = alignUnits(
      doc(...repeatParas(5, 'src')),
      doc(...repeatParas(6, 'tgt')),
    );

    expect(result.pairedCount).toBe(5);
    expect(result.ops.filter((op) => op.kind === 'target-only')).toHaveLength(1);
    expect(result.ops.filter((op) => op.kind === 'source-only')).toHaveLength(0);
    expect(result.mismatchCount).toBe(1);
    expect(result.totalUnits).toBe(6);
  });

  it('번역문에 문단이 1개 누락되면 source-only 1개가 된다 (5:4)', () => {
    const result = alignUnits(
      doc(...repeatParas(5, 'src')),
      doc(...repeatParas(4, 'tgt')),
    );

    expect(result.pairedCount).toBe(4);
    expect(result.ops.filter((op) => op.kind === 'source-only')).toHaveLength(1);
    expect(result.ops.filter((op) => op.kind === 'target-only')).toHaveLength(0);
    expect(result.mismatchCount).toBe(1);
    expect(result.totalUnits).toBe(5);
  });

  it('중간 heading의 레벨만 달라도 그 자리만 불일치로 남는다', () => {
    const result = alignUnits(
      doc(para('머리말'), heading(2, '제목'), para('본문')),
      doc(para('intro'), heading(3, 'Title'), para('body')),
    );

    expect(result.ops.map((op) => op.kind)).toEqual([
      'pair',
      'source-only',
      'target-only',
      'pair',
    ]);
    expect(result.pairedCount).toBe(2);
    expect(result.mismatchCount).toBe(2);
  });

  it('한쪽에만 있는 빈 문단은 정렬에서 제외한다', () => {
    const result = alignUnits(
      doc(para('첫 문단'), para('둘째 문단')),
      doc(para('first'), para(''), para(''), para(''), para('second')),
    );

    expect(result.pairedCount).toBe(2);
    expect(result.mismatchCount).toBe(0);
    expect(result.totalUnits).toBe(2);
    expect(result.ratio).toBe(1);
  });

  it('번역문이 비어 있으면 전부 source-only가 된다', () => {
    const result = alignUnits(doc(...repeatParas(5, 'src')), doc(para('')));

    expect(result.ops.filter((op) => op.kind === 'source-only')).toHaveLength(5);
    expect(result.pairedCount).toBe(0);
    expect(result.mismatchCount).toBe(5);
    expect(result.totalUnits).toBe(5);
    expect(result.ratio).toBe(0);
  });

  it('500 × 500은 LCS 경로로 100ms 안에 처리한다', () => {
    const source = doc(...repeatParas(500, 'src'));
    const target = doc(...repeatParas(500, 'tgt'));

    const startedAt = performance.now();
    const result = alignUnits(source, target);
    const elapsed = performance.now() - startedAt;

    expect(result.degraded).toBe(false);
    expect(result.pairedCount).toBe(500);
    expect(result.ratio).toBe(1);
    expect(elapsed).toBeLessThan(100);
  });

  it('600 × 600은 상한을 넘어 순번 매칭 폴백으로 내려간다', () => {
    const result = alignUnits(
      doc(...repeatParas(600, 'src')),
      doc(...repeatParas(600, 'tgt')),
    );

    expect(result.degraded).toBe(true);
    expect(result.pairedCount).toBe(600);
    expect(result.mismatchCount).toBe(0);
  });
});
