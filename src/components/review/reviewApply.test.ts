import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import type { SearchMatch } from '@/editor/extensions/SearchHighlight';
import { findSegmentRange } from '@/editor/extensions/SearchHighlight';
import {
  filterMatchesBySegment,
  findExcerptRange,
  deriveReplacementText,
  resolveReplacementText,
  findBestSentenceMatch,
  resolveSuggestionRange,
} from './reviewApply';
import { normalizeSegmentGroupId } from './reviewApply';

describe('filterMatchesBySegment', () => {
  it('segment 범위가 없고 매치가 하나면 유지한다 (segmentGroupId 존재)', () => {
    const matches: SearchMatch[] = [{ from: 10, to: 20 }];

    const result = filterMatchesBySegment(matches, null, true, true);

    expect(result).toEqual(matches);
  });

  it('segment 범위 밖 매치는 제거한다', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 20 },
      { from: 40, to: 50 },
    ];
    const range = { from: 30, to: 60 };

    const result = filterMatchesBySegment(matches, range, true, true);

    expect(result).toEqual([{ from: 40, to: 50 }]);
  });

  it('segmentGroupId가 없으면 범위 필터를 적용하지 않는다', () => {
    const matches: SearchMatch[] = [{ from: 10, to: 20 }];

    const result = filterMatchesBySegment(matches, { from: 30, to: 60 }, false, true);

    expect(result).toEqual(matches);
  });

  it('segment 범위가 없고 문서에 segmentGroupId가 없으면 매치를 유지한다', () => {
    const matches: SearchMatch[] = [{ from: 10, to: 20 }];

    const result = filterMatchesBySegment(matches, null, true, false);

    expect(result).toEqual(matches);
  });

  it('segment 범위가 없고 매치가 여러 개면 제거한다 (문서에 segmentGroupId 존재)', () => {
    const matches: SearchMatch[] = [
      { from: 10, to: 20 },
      { from: 30, to: 40 },
    ];

    const result = filterMatchesBySegment(matches, null, true, true);

    expect(result).toEqual([]);
  });
});

describe('normalizeSegmentGroupId', () => {
  it('leading # 제거', () => {
    expect(normalizeSegmentGroupId('#0')).toBe('0');
  });

  it('값이 없으면 undefined', () => {
    expect(normalizeSegmentGroupId(undefined)).toBeUndefined();
  });

  it('그 외는 그대로 반환', () => {
    expect(normalizeSegmentGroupId('seg-1')).toBe('seg-1');
  });
});

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        segmentGroupId: { default: null },
      },
    },
  },
});

function buildDoc(seg1Text: string, seg2Text: string) {
  return schema.node('doc', null, [
    schema.node('paragraph', { segmentGroupId: 'seg-1' }, schema.text(seg1Text)),
    schema.node('paragraph', { segmentGroupId: 'seg-2' }, schema.text(seg2Text)),
  ]);
}

describe('findExcerptRange', () => {
  it('excerpt를 찾으면 문서 범위를 반환한다', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    const range = findExcerptRange(doc, 'Hello world', undefined);

    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('Hello world');
  });

  it('마크다운 서식이 있는 excerpt도 정규화해 찾는다', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    const range = findExcerptRange(doc, '**Hello** _world_', undefined);

    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('Hello world');
  });

  it('segmentGroupId가 있으면 해당 세그먼트 범위 내 매치를 반환한다', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    const range = findExcerptRange(doc, 'Hello world', 'seg-2');

    const seg2 = findSegmentRange(doc, 'seg-2');
    expect(range).not.toBeNull();
    expect(range!.from).toBeGreaterThanOrEqual(seg2!.from);
    expect(range!.to).toBeLessThanOrEqual(seg2!.to);
  });

  it('# 접두사가 붙은 segmentGroupId도 정규화해 처리한다', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    const range = findExcerptRange(doc, 'Hello world', '#seg-2');

    const seg2 = findSegmentRange(doc, 'seg-2');
    expect(range).not.toBeNull();
    expect(range!.from).toBeGreaterThanOrEqual(seg2!.from);
  });

  it('세그먼트가 있는 문서에서 segmentGroupId를 못 찾으면 null', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    expect(findExcerptRange(doc, 'Hello world', 'missing-seg')).toBeNull();
  });

  it('텍스트가 없으면 null', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    expect(findExcerptRange(doc, 'Not in document', undefined)).toBeNull();
  });

  it('정규화 후 빈 excerpt는 null', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    expect(findExcerptRange(doc, '<strong></strong>', undefined)).toBeNull();
    expect(findExcerptRange(doc, '', undefined)).toBeNull();
  });
});

describe('deriveReplacementText', () => {
  it('HTML 태그를 제거한다', () => {
    expect(deriveReplacementText('<strong>fixed text</strong>')).toBe('fixed text');
  });

  it('인라인 마크다운을 제거한다', () => {
    expect(deriveReplacementText('**fixed** `text`')).toBe('fixed text');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(deriveReplacementText('  fixed text ')).toBe('fixed text');
  });

  it('빈 값은 빈 문자열을 반환한다', () => {
    expect(deriveReplacementText('')).toBe('');
    expect(deriveReplacementText('<em></em>')).toBe('');
  });

  it('감싸는 따옴표는 여기서 제거하지 않는다 (apply 시점 조건부 처리)', () => {
    expect(deriveReplacementText('「도망쳐, 어서!」')).toBe('「도망쳐, 어서!」');
    expect(deriveReplacementText('"Run, now!"')).toBe('"Run, now!"');
  });
});

describe('resolveReplacementText', () => {
  it('문서 대상이 인용 대사면 suggestion 따옴표를 유지한다', () => {
    expect(resolveReplacementText('「도망쳐, 어서!」', '「도망쳐!」')).toBe('「도망쳐, 어서!」');
    expect(resolveReplacementText('“Run, now!”', '“Run!”')).toBe('“Run, now!”');
  });

  it('문서 대상이 비인용이면 suggestion의 감싸는 따옴표를 제거한다', () => {
    expect(resolveReplacementText('"Run, now!"', 'Run now')).toBe('Run, now!');
    expect(resolveReplacementText('「도망쳐!」', '도망쳐')).toBe('도망쳐!');
  });

  it('suggestion이 감싸져 있지 않으면 그대로 반환한다', () => {
    expect(resolveReplacementText('plain text', '무엇이든')).toBe('plain text');
  });

  it('불균형 다중 인용은 감싸기로 보지 않아 그대로 유지한다', () => {
    const text = '"Stop," he said. "It\'s over."';
    expect(resolveReplacementText(text, 'nothing')).toBe(text);
  });
});

describe('findExcerptRange 따옴표 관용', () => {
  it('excerpt가 곡선 따옴표로 감싸져 있어도 찾는다', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    const range = findExcerptRange(doc, '“Hello world”', undefined);

    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('Hello world');
  });

  it('excerpt가 직선 따옴표로 감싸져 있어도 찾는다', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    const range = findExcerptRange(doc, '"Hello world"', undefined);

    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('Hello world');
  });
});

const SENT_1 = 'Can identify timelines and execution steps for each subtask during planning.';
const SENT_2 = 'Can accurately understand the given problem and solution when executing the task, well enough to explain them.';

describe('findBestSentenceMatch', () => {
  it('문장 전체 excerpt가 조금 달라도 가장 유사한 문장을 찾는다', () => {
    const doc = buildDoc(SENT_1, SENT_2);
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';

    const match = findBestSentenceMatch(doc, excerpt);

    expect(match).not.toBeNull();
    expect(doc.textBetween(match!.from, match!.to)).toBe(SENT_2);
    expect(match!.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('짧은 조각 excerpt는 문장 매치로 인정하지 않는다', () => {
    const doc = buildDoc(SENT_1, SENT_2);
    expect(findBestSentenceMatch(doc, 'when executing the task,')).toBeNull();
  });

  it('빈 excerpt는 null', () => {
    const doc = buildDoc(SENT_1, SENT_2);
    expect(findBestSentenceMatch(doc, '')).toBeNull();
  });
});

describe('resolveSuggestionRange', () => {
  it('정확 매치 시 fuzzy=false', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    const resolved = resolveSuggestionRange(doc, 'Hello world', undefined, 'Hi world');

    expect(resolved).not.toBeNull();
    expect(resolved!.fuzzy).toBe(false);
    expect(doc.textBetween(resolved!.from, resolved!.to)).toBe('Hello world');
  });

  it('정확 매치 실패 시 유사 문장 전체 범위를 fuzzy=true로 반환한다', () => {
    const doc = buildDoc(SENT_1, SENT_2);
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';
    const replacement =
      'Can understand the given problem and solution well enough to explain them at the time of performing the task.';

    const resolved = resolveSuggestionRange(doc, excerpt, undefined, replacement);

    expect(resolved).not.toBeNull();
    expect(resolved!.fuzzy).toBe(true);
    expect(doc.textBetween(resolved!.from, resolved!.to)).toBe(SENT_2);
  });

  it('교체문이 문장 대비 너무 짧으면 문장 교체를 포기한다', () => {
    const doc = buildDoc(SENT_1, SENT_2);
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';

    const resolved = resolveSuggestionRange(doc, excerpt, undefined, 'short bit');

    expect(resolved).toBeNull();
  });
});

// 실제 앱 문서 구조 재현: 문단 + 불릿리스트 (listItem > paragraph)
const richSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph+' },
  },
});

function buildRichDoc() {
  return richSchema.node('doc', null, [
    richSchema.node('paragraph', null, richSchema.text('At this competency level, engineers are expected to understand problems.')),
    richSchema.node('bulletList', null, [
      richSchema.node('listItem', null, [
        richSchema.node('paragraph', null, richSchema.text('Can distinguish what they do and do not know.')),
      ]),
      richSchema.node('listItem', null, [
        richSchema.node('paragraph', null, richSchema.text('Can identify timelines for each subtask.')),
      ]),
    ]),
  ]);
}

describe('findExcerptRange 블록 경계 (세그먼트 마크다운 excerpt 재현)', () => {
  it('단일 불릿 문장 excerpt를 찾는다', () => {
    const doc = buildRichDoc();
    const range = findExcerptRange(doc, 'Can distinguish what they do and do not know.', undefined);
    expect(range).not.toBeNull();
  });

  it('여러 불릿에 걸친 멀티라인 excerpt도 찾는다', () => {
    const doc = buildRichDoc();
    // AI가 세그먼트 마크다운에서 복사한 형태 (줄바꿈 + 리스트 마커 포함)
    const excerpt = 'Can distinguish what they do and do not know.\n- Can identify timelines for each subtask.';
    const range = findExcerptRange(doc, excerpt, undefined);
    expect(range).not.toBeNull();
  });

  it('문단과 불릿에 걸친 excerpt도 찾는다', () => {
    const doc = buildRichDoc();
    const excerpt = 'engineers are expected to understand problems.\n\n- Can distinguish what they do';
    const range = findExcerptRange(doc, excerpt, undefined);
    expect(range).not.toBeNull();
  });

  it('블록 경계에서 문장이 이어 붙지 않는다 (거짓 매치 방지)', () => {
    const doc = buildRichDoc();
    // 블록 경계를 공백 없이 이어붙인 텍스트는 매치되면 안 됨
    expect(findExcerptRange(doc, 'problems.Can distinguish', undefined)).toBeNull();
  });
});
