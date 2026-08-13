import { describe, expect, it } from 'vitest';
import type { TranslationUnit } from '@/editor/extensions/TranslationUnitId';
import {
  CONTINUE_CONTEXT_MAX_CHARS,
  buildContinuationPlan,
  contentUnits,
  planFromUnits,
} from './continueTranslation';

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const cell = (text: string) => ({
  type: 'tableCell',
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const table = (...texts: string[]) => ({
  type: 'table',
  content: [{ type: 'tableRow', content: texts.map(cell) }],
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('buildContinuationPlan', () => {
  it('앞 2문단만 번역된 문서에서 남은 suffix를 범위로 잡는다', () => {
    const source = doc(p('A'), p('B'), p('C'), p('D'));
    const target = doc(p('가'), p('나'));

    const result = buildContinuationPlan(source, target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.remainingUnitCount).toBe(2);
    expect(result.plan.remainingBlockCount).toBe(2);
    expect(result.plan.remainingSourceDoc).toEqual(doc(p('C'), p('D')));
    expect(result.plan.middleGapUnitCount).toBe(0);
  });

  it('heading이 섞인 문서도 prefix 대응이 맞으면 경계를 찾는다', () => {
    const source = doc(h(1, 'T1'), p('A'), p('B'), h(2, 'T2'), p('C'));
    const target = doc(h(1, '제목1'), p('가'), p('나'));

    const result = buildContinuationPlan(source, target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.remainingUnitCount).toBe(2);
    expect(result.plan.remainingSourceDoc).toEqual(doc(h(2, 'T2'), p('C')));
  });

  it('전부 번역된 문서는 nothing-remaining', () => {
    const result = buildContinuationPlan(doc(p('A'), p('B')), doc(p('가'), p('나')));

    expect(result).toEqual({ ok: false, reason: 'nothing-remaining' });
  });

  it('번역문이 비어 있으면 empty-target', () => {
    expect(buildContinuationPlan(doc(p('A'), p('B')), doc())).toEqual({
      ok: false,
      reason: 'empty-target',
    });
    // 빈 문단만 있는 target도 콘텐츠 유닛이 0개다
    expect(buildContinuationPlan(doc(p('A'), p('B')), doc(p('')))).toEqual({
      ok: false,
      reason: 'empty-target',
    });
  });

  it('구조가 어긋나면 misaligned-prefix로 기능을 끈다', () => {
    // 번역문 2번째가 heading인데 원문 2번째는 paragraph — prefix 번역이 아니다
    const source = doc(h(1, 'T1'), p('A'), p('B'), p('C'));
    const target = doc(h(1, '제목1'), h(2, '제목2'));

    expect(buildContinuationPlan(source, target)).toEqual({
      ok: false,
      reason: 'misaligned-prefix',
    });
  });

  it('heading 레벨이 다르면 misaligned-prefix (h2↔h3 오매칭 방지)', () => {
    const source = doc(h(2, 'T1'), p('A'), p('B'));
    const target = doc(h(3, '제목1'));

    expect(buildContinuationPlan(source, target)).toEqual({
      ok: false,
      reason: 'misaligned-prefix',
    });
  });

  it('부분 번역된 표는 통째로 제외한다 (셀 단위로 자르지 않는다)', () => {
    const source = doc(p('A'), table('c1', 'c2'), p('D'));
    // 표의 첫 셀만 번역된 상태
    const target = doc(p('가'), table('셀1', ''));

    const result = buildContinuationPlan(source, target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 표(인덱스 1)는 범위 밖 — 남는 건 마지막 문단뿐
    expect(result.plan.remainingSourceDoc).toEqual(doc(p('D')));
    expect(result.plan.remainingUnitCount).toBe(1);
    // 표 안에 대응 없는 유닛(둘째 셀 + 그 안 문단)은 정보용으로 센다
    expect(result.plan.middleGapUnitCount).toBe(2);
  });

  it('표가 마지막 블록이고 일부만 번역됐으면 nothing-remaining', () => {
    const source = doc(p('A'), table('c1', 'c2'));
    const target = doc(p('가'), table('셀1', ''));

    expect(buildContinuationPlan(source, target)).toEqual({
      ok: false,
      reason: 'nothing-remaining',
    });
  });

  it('경계 뒤의 비유닛 블록(hr)도 범위 슬라이스에 포함한다', () => {
    const source = doc(p('A'), { type: 'horizontalRule' }, p('B'));
    const target = doc(p('가'));

    const result = buildContinuationPlan(source, target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.remainingSourceDoc).toEqual(doc({ type: 'horizontalRule' }, p('B')));
    expect(result.plan.remainingBlockCount).toBe(2);
    expect(result.plan.remainingUnitCount).toBe(1);
  });

  it('원본 문서를 변형하지 않는다', () => {
    const source = doc(p('A'), p('B'), p('C'));
    const target = doc(p('가'));
    const snapshot = JSON.parse(JSON.stringify(source));

    buildContinuationPlan(source, target);

    expect(source).toEqual(snapshot);
  });
});

describe('contextPairs', () => {
  it('마지막 3쌍만 담는다', () => {
    const source = doc(p('A'), p('B'), p('C'), p('D'), p('E'));
    const target = doc(p('가'), p('나'), p('다'), p('라'));

    const result = buildContinuationPlan(source, target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.contextPairs).toEqual([
      { source: 'B', target: '나' },
      { source: 'C', target: '다' },
      { source: 'D', target: '라' },
    ]);
  });

  it('유닛당 400자로 자른다', () => {
    const long = 'x'.repeat(CONTINUE_CONTEXT_MAX_CHARS + 50);
    const source = doc(p(long), p('B'));
    const target = doc(p(long));

    const result = buildContinuationPlan(source, target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pair = result.plan.contextPairs[0];
    expect(pair?.source).toBe(`${'x'.repeat(CONTINUE_CONTEXT_MAX_CHARS)}…`);
    expect(pair?.target).toBe(`${'x'.repeat(CONTINUE_CONTEXT_MAX_CHARS)}…`);
  });
});

describe('planFromUnits', () => {
  const unit = (type: string, top: number, text: string, level?: number): TranslationUnit => ({
    type,
    path: [top],
    text,
    ...(level === undefined ? {} : { level }),
  });

  it('유닛 목록만으로 게이트를 판정한다', () => {
    const sourceUnits = [unit('paragraph', 0, 'A'), unit('paragraph', 1, 'B')];
    const targetUnits = [unit('paragraph', 0, '가')];

    const result = planFromUnits(sourceUnits, targetUnits, doc(p('A'), p('B')));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.remainingUnitCount).toBe(1);
  });

  it('번역문 유닛이 원문보다 많으면 nothing-remaining', () => {
    const sourceUnits = [unit('paragraph', 0, 'A')];
    const targetUnits = [unit('paragraph', 0, '가'), unit('paragraph', 1, '나')];

    expect(planFromUnits(sourceUnits, targetUnits, doc(p('A')))).toEqual({
      ok: false,
      reason: 'nothing-remaining',
    });
  });
});

describe('contentUnits', () => {
  it('빈 문단은 유닛에서 제외한다', () => {
    expect(contentUnits(doc(p('A'), p(''), p('B'))).map((unit) => unit.text)).toEqual(['A', 'B']);
  });
});
