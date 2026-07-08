import { describe, it, expect } from 'vitest';
import {
  buildDocDiffPlan,
  mergeDocBySelection,
  extractBlockText,
} from './docBlockDiff';
import type { TipTapDocJson } from '@/utils/markdownConverter';

function p(text: string): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  };
}

function list(...itemTexts: string[]): Record<string, unknown> {
  return {
    type: 'bulletList',
    content: itemTexts.map((text) => ({ type: 'listItem', content: [p(text)] })),
  };
}

/** paragraph + 중첩 bulletList를 가진 listItem 하나로 이루어진 bulletList */
function nestedList(parentText: string, childText: string): Record<string, unknown> {
  return {
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [p(parentText), list(childText)],
      },
    ],
  };
}

/** text + hardBreak + text 인라인을 가진 paragraph */
function paraWithBreak(a: string, b: string): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: a },
      { type: 'hardBreak' },
      { type: 'text', text: b },
    ],
  };
}

function doc(...blocks: Record<string, unknown>[]): TipTapDocJson {
  return { type: 'doc', content: blocks };
}

function mergedTexts(merged: TipTapDocJson): string[] {
  const content = (merged.content ?? []) as Array<Record<string, unknown>>;
  return content.map((b) => extractBlockText(b));
}

function allUnitIds(plan: ReturnType<typeof buildDocDiffPlan>): Set<string> {
  return new Set(plan.units.map((u) => u.id));
}

describe('buildDocDiffPlan', () => {
  it('동일한 문서는 unit이 없다', () => {
    const a = doc(p('Hello world.'), p('Second paragraph.'));
    const b = doc(p('Hello world.'), p('Second paragraph.'));

    expect(buildDocDiffPlan(a, b).units).toHaveLength(0);
  });

  it('공백만 다른 문단은 unit이 없다', () => {
    const a = doc(p('Hello  world.'));
    const b = doc(p('Hello world. '));

    expect(buildDocDiffPlan(a, b).units).toHaveLength(0);
  });

  it('한글 사이 공백만 다른 문단은 unit이 없다 (마크 경계 공백 오탐 방지)', () => {
    // 폴리싱 결과가 볼드/링크 뒤에 공백을 흡수하거나 삽입해 "기능 은"↔"기능은"으로
    // 벌어져도, 세분화 정규화로 오탐이 생기지 않아야 한다.
    const a = doc(p('이 기능 은 매우 유용합니다.'));
    const b = doc(p('이 기능은 매우 유용합니다.'));

    expect(buildDocDiffPlan(a, b).units).toHaveLength(0);
  });

  it('실제 표현이 바뀐 문장만 unit이 되고, 뒤 문장은 공백 차이로 오탐되지 않는다', () => {
    // 앞 문장은 실제로 바뀌고(유효 unit), 뒷 문장은 마크 경계 공백만 달라도 unit이 아님.
    const a = doc(p('이 기능은 매우 유용합니다. 두 번째 문장 은 유지.'));
    const b = doc(p('이 기능은 정말 유용합니다. 두 번째 문장은 유지.'));

    const plan = buildDocDiffPlan(a, b);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.originalText).toBe('이 기능은 매우 유용합니다.');
    expect(plan.units[0]!.polishedText).toBe('이 기능은 정말 유용합니다.');
  });

  it('문단 내 한 문장만 바뀌면 unit은 그 문장만 담는다', () => {
    const a = doc(p('First stays here. Second old sentence here.'));
    const b = doc(p('First stays here. Second new sentence here.'));

    const plan = buildDocDiffPlan(a, b);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.originalText).toBe('Second old sentence here.');
    expect(plan.units[0]!.polishedText).toBe('Second new sentence here.');
    expect(plan.units[0]!.blockLabel).toBe('¶1');
  });

  it('한 문단의 여러 문장 변경은 각각 unit이 된다', () => {
    const a = doc(p('Alpha old one. Same middle here. Beta old two.'));
    const b = doc(p('Alpha new one. Same middle here. Beta new two.'));

    const plan = buildDocDiffPlan(a, b);

    expect(plan.units).toHaveLength(2);
    expect(plan.units[0]!.originalText).toBe('Alpha old one.');
    expect(plan.units[0]!.polishedText).toBe('Alpha new one.');
    expect(plan.units[1]!.originalText).toBe('Beta old two.');
    expect(plan.units[1]!.polishedText).toBe('Beta new two.');
  });

  it('문단 추가는 originalText가 빈 unit이 된다', () => {
    const a = doc(p('First sentence here.'), p('Last sentence here.'));
    const b = doc(p('First sentence here.'), p('Inserted paragraph.'), p('Last sentence here.'));

    const plan = buildDocDiffPlan(a, b);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.originalText).toBe('');
    expect(plan.units[0]!.polishedText).toBe('Inserted paragraph.');
  });

  it('문단 삭제는 polishedText가 빈 unit이 된다', () => {
    const a = doc(p('First sentence here.'), p('Removed paragraph.'), p('Last sentence here.'));
    const b = doc(p('First sentence here.'), p('Last sentence here.'));

    const plan = buildDocDiffPlan(a, b);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.originalText).toBe('Removed paragraph.');
    expect(plan.units[0]!.polishedText).toBe('');
  });

  it('리스트 항목 변경은 해당 항목의 문장 단위 unit이 된다', () => {
    const a = doc(p('Intro paragraph here.'), list('Old item text here.', 'Same item text.'));
    const b = doc(p('Intro paragraph here.'), list('New item text here.', 'Same item text.'));

    const plan = buildDocDiffPlan(a, b);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.originalText).toBe('Old item text here.');
    expect(plan.units[0]!.polishedText).toBe('New item text here.');
    expect(plan.units[0]!.blockLabel).toBe('¶2');
  });

  it('unit id는 고유하다', () => {
    const a = doc(p('a one. a two.'), p('b same.'), p('c old.'));
    const b = doc(p('a ONE. a TWO.'), p('b same.'), p('c new.'));

    const plan = buildDocDiffPlan(a, b);
    const ids = plan.units.map((u) => u.id);

    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mergeDocBySelection', () => {
  it('아무것도 선택하지 않으면 원본 블록 객체를 그대로 유지한다', () => {
    const block = p('Old sentence one. Old sentence two.');
    const a = doc(block, p('Same paragraph.'));
    const b = doc(p('New sentence one. New sentence two.'), p('Same paragraph.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, new Set());

    const content = merged.content as unknown[];
    expect(content[0]).toBe(block);
    expect(mergedTexts(merged)).toEqual(['Old sentence one. Old sentence two.', 'Same paragraph.']);
  });

  it('전체 선택하면 폴리싱 텍스트와 동일해진다', () => {
    const a = doc(p('Alpha old one. Same middle here. Beta old two.'), p('Removed paragraph.'));
    const b = doc(p('Alpha new one. Same middle here. Beta new two.'), p('Inserted other.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, allUnitIds(plan));

    expect(mergedTexts(merged)).toEqual([
      'Alpha new one. Same middle here. Beta new two.',
      'Inserted other.',
    ]);
  });

  it('문단 내 문장 부분 선택 시 선택한 문장만 반영된다', () => {
    const a = doc(p('Alpha old one. Same middle here. Beta old two.'));
    const b = doc(p('Alpha new one. Same middle here. Beta new two.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, new Set([plan.units[0]!.id]));

    expect(mergedTexts(merged)).toEqual(['Alpha new one. Same middle here. Beta old two.']);
  });

  it('부분 선택으로 재구성된 문단은 원본 attrs를 유지한다', () => {
    const block = {
      type: 'paragraph',
      attrs: { segmentGroupId: 'seg-1' },
      content: [{ type: 'text', text: 'Alpha old one. Beta old two.' }],
    };
    const a = doc(block);
    const b = doc(p('Alpha new one. Beta new two.'));

    const plan = buildDocDiffPlan(a, b);
    expect(plan.units).toHaveLength(2);
    const merged = mergeDocBySelection(a, plan, new Set([plan.units[0]!.id]));

    const first = (merged.content as Array<Record<string, unknown>>)[0]!;
    expect(first.attrs).toEqual({ segmentGroupId: 'seg-1' });
    expect(extractBlockText(first)).toBe('Alpha new one. Beta old two.');
  });

  it('문단 삭제 unit을 선택하면 해당 문단이 제거된다', () => {
    const a = doc(p('First sentence here.'), p('Removed paragraph.'), p('Last sentence here.'));
    const b = doc(p('First sentence here.'), p('Last sentence here.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, allUnitIds(plan));

    expect(mergedTexts(merged)).toEqual(['First sentence here.', 'Last sentence here.']);
  });

  it('리스트 항목 부분 선택 시 해당 항목만 바뀌고 나머지 항목 노드는 유지된다', () => {
    const originalList = list('Old item text here.', 'Same item text.');
    const a = doc(originalList);
    const b = doc(list('New item text here.', 'Same item text.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, allUnitIds(plan));

    const mergedList = (merged.content as Array<Record<string, unknown>>)[0]!;
    expect(extractBlockText(mergedList)).toContain('New item text here.');
    const mergedItems = mergedList.content as unknown[];
    const originalItems = originalList.content as unknown[];
    expect(mergedItems[1]).toBe(originalItems[1]);
  });
});

describe('평탄하지 않은 블록은 통째 swap (F5)', () => {
  it('중첩 리스트 항목은 문장 세분화 대신 항목 통째 swap이 된다', () => {
    const a = doc(nestedList('Parent old sentence.', 'Child old sentence.'));
    const b = doc(nestedList('Parent new sentence.', 'Child new sentence.'));

    const plan = buildDocDiffPlan(a, b);
    // 평탄하지 않은 listItem이라 문장 단위 unit이 아니라 항목 통째 swap 1개
    expect(plan.units).toHaveLength(1);
  });

  it('중첩 리스트 항목 선택 시 polished 통째 반영 + 중첩 구조/marks 보존', () => {
    const a = doc(nestedList('Parent old sentence.', 'Child old sentence.'));
    const b = doc(nestedList('Parent new sentence.', 'Child new sentence.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, allUnitIds(plan));

    const mergedList = (merged.content as Array<Record<string, unknown>>)[0]!;
    const item = (mergedList.content as Array<Record<string, unknown>>)[0]!;
    // paragraph + 중첩 bulletList 두 자식 구조가 보존됨
    expect((item.content as unknown[]).length).toBe(2);
    // \n 리터럴이 text 노드로 남지 않음 (rebuildLeaf 평탄화 파괴 없음)
    expect(JSON.stringify(item)).not.toContain('\\n');
    expect(extractBlockText(item)).toContain('Child new sentence.');
  });

  it('중첩 리스트 항목 미선택 시 원본 통째 유지', () => {
    const a = doc(nestedList('Parent old sentence.', 'Child old sentence.'));
    const b = doc(nestedList('Parent new sentence.', 'Child new sentence.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, new Set());

    const mergedList = (merged.content as Array<Record<string, unknown>>)[0]!;
    const item = (mergedList.content as Array<Record<string, unknown>>)[0]!;
    expect(extractBlockText(item)).toContain('Child old sentence.');
  });

  it('hardBreak 포함 문단은 swap으로 강등되고 구조가 보존된다', () => {
    const a = doc(paraWithBreak('Line one here.', 'Line two here.'));
    const b = doc(paraWithBreak('Line one changed.', 'Line two changed.'));

    const plan = buildDocDiffPlan(a, b);
    expect(plan.units).toHaveLength(1);

    const merged = mergeDocBySelection(a, plan, allUnitIds(plan));
    const para = (merged.content as Array<Record<string, unknown>>)[0]!;
    const hasBreak = (para.content as Array<Record<string, unknown>>).some(
      (c) => c.type === 'hardBreak',
    );
    expect(hasBreak).toBe(true);
  });

  it('평탄 문단은 기존처럼 문장 부분 병합이 유지된다 (회귀 방지)', () => {
    const a = doc(p('Alpha old one. Same middle here. Beta old two.'));
    const b = doc(p('Alpha new one. Same middle here. Beta new two.'));

    const plan = buildDocDiffPlan(a, b);
    const merged = mergeDocBySelection(a, plan, new Set([plan.units[0]!.id]));

    expect(mergedTexts(merged)).toEqual(['Alpha new one. Same middle here. Beta old two.']);
  });
});
