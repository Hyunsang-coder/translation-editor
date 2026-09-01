import { describe, it, expect } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ReviewIssue } from '@/stores/reviewStore';
import {
  ANCHOR_TOP_GAP_PX,
  findUnitIdAtRange,
  findUnitRange,
  resolveAnchorScrollTop,
  resolveReviewIssueNavigation,
} from '@/editor/utils/reviewIssueNavigation';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { translationUnitId: { default: null } },
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { translationUnitId: { default: null }, level: { default: 1 } },
    },
  },
});

type UnitSpec = { id?: string | null; text: string; heading?: boolean };

function buildDoc(units: UnitSpec[]): ProseMirrorNode {
  return schema.node(
    'doc',
    null,
    units.map((unit) =>
      schema.node(
        unit.heading ? 'heading' : 'paragraph',
        {
          translationUnitId: unit.id ?? null,
          ...(unit.heading ? { level: 1 } : {}),
        },
        unit.text ? schema.text(unit.text) : undefined,
      ),
    ),
  );
}

function makeIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    id: 'issue-1',
    segmentOrder: 0,
    segmentGroupId: undefined,
    sourceExcerpt: '반동이 감소했습니다.',
    targetExcerpt: 'The recoil was reduced.',
    suggestedFix: 'Recoil has been reduced.',
    type: 'mistranslation',
    severity: 'major',
    description: '설명',
    checked: false,
    ...overrides,
  };
}

describe('resolveReviewIssueNavigation — 일반 이슈', () => {
  const sourceDoc = buildDoc([
    { id: 's1', text: '반동이 감소했습니다.' },
    { id: 's2', text: '투척류가 변경되었습니다.' },
  ]);
  const targetDoc = buildDoc([
    { id: 's1', text: 'The recoil was reduced.' },
    { id: 's2', text: 'Throwables changed.' },
  ]);

  it('양쪽 발췌문을 각각 정확히 찾고 번역문을 의미상 기준으로 삼는다', () => {
    const nav = resolveReviewIssueNavigation({ issue: makeIssue(), sourceDoc, targetDoc });

    expect(nav.primarySide).toBe('target');
    expect(nav.source.kind).toBe('exact-range');
    expect(nav.target.kind).toBe('exact-range');
    expect(sourceDoc.textBetween(nav.source.range!.from, nav.source.range!.to))
      .toBe('반동이 감소했습니다.');
    expect(targetDoc.textBetween(nav.target.range!.from, nav.target.range!.to))
      .toBe('The recoil was reduced.');
  });

  it('정확 매치는 대응 유닛 폴백보다 우선한다 (앵커에 유닛 ID도 함께 담는다)', () => {
    const nav = resolveReviewIssueNavigation({ issue: makeIssue(), sourceDoc, targetDoc });

    expect(nav.target.unitId).toBe('s1');
    expect(nav.source.unitId).toBe('s1');
  });

  it('두 번째 유닛의 이슈는 두 번째 유닛 범위를 가리킨다', () => {
    const issue = makeIssue({
      sourceExcerpt: '투척류가 변경되었습니다.',
      targetExcerpt: 'Throwables changed.',
    });
    const nav = resolveReviewIssueNavigation({ issue, sourceDoc, targetDoc });

    expect(nav.source.unitId).toBe('s2');
    expect(nav.target.unitId).toBe('s2');
  });
});

describe('resolveReviewIssueNavigation — 누락·추가 이슈', () => {
  it('번역문 발췌문이 없으면 원문이 기준이고 번역문은 대응 유닛으로 간다', () => {
    const sourceDoc = buildDoc([
      { id: 's1', text: '첫 문단입니다.' },
      { id: 's2', text: '빠진 문장입니다.' },
    ]);
    const targetDoc = buildDoc([
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' },
    ]);
    const issue = makeIssue({
      type: 'omission',
      sourceExcerpt: '빠진 문장입니다.',
      targetExcerpt: '',
    });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc, targetDoc });

    expect(nav.primarySide).toBe('source');
    expect(nav.source.kind).toBe('exact-range');
    expect(nav.target.kind).toBe('unit-range');
    expect(nav.target.unitId).toBe('s2');
    expect(nav.target.range).toEqual(findUnitRange(targetDoc, 's2'));
  });

  it('원문 발췌문이 없으면 번역문이 기준이고 원문은 대응 유닛으로 간다', () => {
    const sourceDoc = buildDoc([
      { id: 's1', text: '첫 문단입니다.' },
      { id: 's2', text: '둘째 문단입니다.' },
    ]);
    const targetDoc = buildDoc([
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph with an extra clause.' },
    ]);
    const issue = makeIssue({
      type: 'addition',
      sourceExcerpt: '',
      targetExcerpt: 'Second paragraph with an extra clause.',
    });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc, targetDoc });

    expect(nav.primarySide).toBe('target');
    expect(nav.target.kind).toBe('exact-range');
    expect(nav.source.kind).toBe('unit-range');
    expect(nav.source.unitId).toBe('s2');
  });

  it('대응 유닛의 텍스트조차 없으면 반대쪽은 이동하지 않는다', () => {
    const sourceDoc = buildDoc([{ id: 's1', text: '빠진 문장입니다.' }]);
    const targetDoc = buildDoc([{ id: 't1', text: '' }]);
    const issue = makeIssue({ sourceExcerpt: '빠진 문장입니다.', targetExcerpt: '' });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc, targetDoc });

    expect(nav.source.kind).toBe('exact-range');
    expect(nav.target.kind).toBe('none');
  });
});

describe('resolveReviewIssueNavigation — 유닛 대응 규칙', () => {
  it('ID가 서로 다른 레거시 문서는 LCS 정렬로 대응 유닛을 찾는다', () => {
    const sourceDoc = buildDoc([
      { id: 'src-h', text: '제목', heading: true },
      { id: 'src-p', text: '빠진 문장입니다.' },
    ]);
    const targetDoc = buildDoc([{ id: 'tgt-p', text: 'Existing sentence.' }]);
    const issue = makeIssue({ sourceExcerpt: '빠진 문장입니다.', targetExcerpt: '' });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc, targetDoc });

    expect(nav.target.kind).toBe('unit-range');
    expect(nav.target.unitId).toBe('tgt-p');
  });

  it('짝을 찾지 못한 유닛은 반대쪽을 추측하지 않는다 (fail-closed)', () => {
    const sourceDoc = buildDoc([
      { id: 'src-h', text: '제목입니다', heading: true },
      { id: 'src-p', text: '본문 문장입니다.' },
    ]);
    const targetDoc = buildDoc([{ id: 'tgt-p', text: 'Body sentence.' }]);
    // heading은 번역문에 짝이 없다 — 본문 문단으로 미뤄 짚지 않는다
    const issue = makeIssue({ sourceExcerpt: '제목입니다', targetExcerpt: '' });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc, targetDoc });

    expect(nav.source.kind).toBe('exact-range');
    expect(nav.target.kind).toBe('none');
  });

  it('발췌문이 여러 유닛에 중복되면 이동하지 않는다', () => {
    const targetDoc = buildDoc([
      { id: 't1', text: 'Repeated sentence.' },
      { id: 't2', text: 'Repeated sentence.' },
    ]);
    const issue = makeIssue({ sourceExcerpt: '', targetExcerpt: 'Repeated sentence.' });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc: null, targetDoc });

    expect(nav.target.kind).toBe('none');
  });

  it('같은 유닛 안에서만 중복되면 그 유닛 상단으로 이동한다', () => {
    const targetDoc = buildDoc([
      { id: 't1', text: 'Repeated. Repeated.' },
      { id: 't2', text: 'Other sentence.' },
    ]);
    const issue = makeIssue({ sourceExcerpt: '', targetExcerpt: 'Repeated.' });

    const nav = resolveReviewIssueNavigation({ issue, sourceDoc: null, targetDoc });

    expect(nav.target.kind).toBe('unit-range');
    expect(nav.target.unitId).toBe('t1');
  });

  it('숨겨진 패널(문서 없음)은 none이고 보이는 패널은 그대로 계산한다', () => {
    const targetDoc = buildDoc([{ id: 's1', text: 'The recoil was reduced.' }]);

    const nav = resolveReviewIssueNavigation({ issue: makeIssue(), sourceDoc: null, targetDoc });

    expect(nav.source.kind).toBe('none');
    expect(nav.target.kind).toBe('exact-range');
  });

  it('원문 에디터가 없어도 스냅샷 JSON이 있으면 번역문 대응 유닛을 찾는다', () => {
    const sourceDoc = buildDoc([
      { id: 's1', text: '첫 문단입니다.' },
      { id: 's2', text: '빠진 문장입니다.' },
    ]);
    const targetDoc = buildDoc([
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' },
    ]);
    const issue = makeIssue({ sourceExcerpt: '빠진 문장입니다.', targetExcerpt: '' });

    const nav = resolveReviewIssueNavigation({
      issue,
      sourceDoc: null,
      targetDoc,
      sourceDocJson: sourceDoc.toJSON(),
    });

    expect(nav.source.kind).toBe('none');
    expect(nav.target.kind).toBe('unit-range');
    expect(nav.target.unitId).toBe('s2');
  });
});

describe('findUnitIdAtRange / findUnitRange', () => {
  const doc = buildDoc([
    { id: 'u1', text: '첫 문단' },
    { id: 'u2', text: '둘째 문단' },
  ]);

  it('범위를 감싸는 유닛 ID를 찾는다', () => {
    const second = findUnitRange(doc, 'u2')!;
    expect(findUnitIdAtRange(doc, { from: second.from + 1, to: second.to - 1 })).toBe('u2');
  });

  it('없는 유닛은 null이다', () => {
    expect(findUnitRange(doc, 'nope')).toBeNull();
  });
});

describe('resolveAnchorScrollTop', () => {
  const base = {
    containerTop: 100,
    scrollTop: 0,
    scrollHeight: 5000,
    clientHeight: 600,
    zoom: 1,
  };

  it('앵커를 상단 여백 아래로 올린다', () => {
    expect(resolveAnchorScrollTop({ ...base, anchorTop: 500 }))
      .toBe(400 - ANCHOR_TOP_GAP_PX);
  });

  it('zoom 배율만큼 콘텐츠 좌표로 되돌린다', () => {
    expect(resolveAnchorScrollTop({ ...base, anchorTop: 500, zoom: 2 }))
      .toBe((400 - ANCHOR_TOP_GAP_PX) / 2);
    expect(resolveAnchorScrollTop({ ...base, anchorTop: 500, zoom: 0.5 }))
      .toBe((400 - ANCHOR_TOP_GAP_PX) * 2);
  });

  it('문서 끝을 넘어가지 않게 clamp한다', () => {
    expect(resolveAnchorScrollTop({ ...base, anchorTop: 100000, scrollTop: 4000 }))
      .toBe(4400);
  });

  it('문서 시작 위로 올라가지 않게 clamp한다', () => {
    expect(resolveAnchorScrollTop({ ...base, anchorTop: -100000, scrollTop: 300 })).toBe(0);
  });

  it('이미 상단 여백 안에 있으면 스크롤하지 않는다', () => {
    expect(resolveAnchorScrollTop({ ...base, anchorTop: 100 + ANCHOR_TOP_GAP_PX })).toBeNull();
  });
});
