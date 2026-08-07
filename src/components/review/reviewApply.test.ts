import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import type { SearchMatch } from '@/editor/extensions/SearchHighlight';
import { findSegmentRange, rangeCrossesBlockBoundary } from '@/editor/extensions/SearchHighlight';
import {
  filterMatchesBySegment,
  findExcerptRange,
  deriveReplacementText,
  resolveReplacementText,
  findBestSentenceMatch,
  resolveAlignedUnitRange,
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

  it('segmentGroupId 없이 동일 excerpt가 여러 곳이면 모호 → null (F2)', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    expect(findExcerptRange(doc, 'Hello world', undefined)).toBeNull();
  });

  it('동일 excerpt 여러 곳 + 유효 segmentGroupId면 해당 세그먼트 매치 (F2)', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    const range = findExcerptRange(doc, 'Hello world', 'seg-2');
    const seg2 = findSegmentRange(doc, 'seg-2');

    expect(range).not.toBeNull();
    expect(range!.from).toBeGreaterThanOrEqual(seg2!.from);
    expect(range!.to).toBeLessThanOrEqual(seg2!.to);
  });
});

describe('deriveReplacementText', () => {
  it('HTML 태그를 제거한다', () => {
    expect(deriveReplacementText('<strong>fixed text</strong>')).toBe('fixed text');
  });

  it('인라인 마크다운을 제거한다', () => {
    expect(deriveReplacementText('**fixed** `text`')).toBe('fixed text');
  });

  it('인코딩된 HTML 링크와 Markdown 링크를 텍스트로 변환한다', () => {
    expect(
      deriveReplacementText(
        '문서의 &lt;a href=&quot;https://example.com&quot;&gt;부록&lt;/a&gt;과 [예시](https://example.com/example)',
      ),
    ).toBe('문서의 부록과 예시');
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

  it('segmentGroupId 없음 + 유사 후보 2개면 모호 → null (F1)', () => {
    const doc = buildDoc(SENT_2, SENT_2); // 두 세그먼트 모두 SENT_2 (동일 유사도)
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';
    expect(findBestSentenceMatch(doc, excerpt)).toBeNull();
  });

  it('segmentRange가 지정되면 해당 범위 내 문장만 매치한다 (F1)', () => {
    const doc = buildDoc(SENT_2, SENT_2);
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';
    const seg2 = findSegmentRange(doc, 'seg-2');

    const match = findBestSentenceMatch(doc, excerpt, seg2);

    expect(match).not.toBeNull();
    expect(match!.from).toBeGreaterThanOrEqual(seg2!.from);
    expect(match!.to).toBeLessThanOrEqual(seg2!.to);
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

  it('fuzzy 폴백이 segmentGroupId 범위 안에서만 매치된다 (F1)', () => {
    const doc = buildDoc(SENT_2, SENT_2); // seg-1, seg-2 동일 문장
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';
    const replacement =
      'Can understand the given problem and solution well enough to explain them at the time of performing the task.';

    const resolved = resolveSuggestionRange(doc, excerpt, 'seg-2', replacement);
    const seg2 = findSegmentRange(doc, 'seg-2');

    expect(resolved).not.toBeNull();
    expect(resolved!.fuzzy).toBe(true);
    expect(resolved!.from).toBeGreaterThanOrEqual(seg2!.from);
    expect(resolved!.to).toBeLessThanOrEqual(seg2!.to);
  });

  it('fuzzy 폴백도 세그먼트를 못 찾으면 null (F1)', () => {
    const doc = buildDoc(SENT_2, SENT_2);
    const excerpt =
      'Can understand the given problem and solution accurately enough to explain them when executing the task.';
    const replacement =
      'Can understand the given problem and solution well enough to explain them at the time of performing the task.';

    expect(resolveSuggestionRange(doc, excerpt, 'missing-seg', replacement)).toBeNull();
  });
});

describe('rangeCrossesBlockBoundary (F3)', () => {
  it('블록 내부 범위는 경계를 넘지 않는다', () => {
    const doc = buildRichDoc();
    const range = findExcerptRange(doc, 'Can distinguish what they do and do not know.', undefined);
    expect(range).not.toBeNull();
    expect(rangeCrossesBlockBoundary(doc, range!.from, range!.to)).toBe(false);
  });

  it('블록 경계를 넘는 범위를 감지한다', () => {
    const doc = buildRichDoc();
    const excerpt = 'engineers are expected to understand problems.\n\n- Can distinguish what they do';
    const range = findExcerptRange(doc, excerpt, undefined);
    // 매칭(하이라이트)은 여전히 성공하지만 교체는 경계를 넘음
    expect(range).not.toBeNull();
    expect(rangeCrossesBlockBoundary(doc, range!.from, range!.to)).toBe(true);
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

// ============================================
// 유닛 정렬 prior (resolveAlignedUnitRange)
// ============================================

const unitSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        segmentGroupId: { default: null },
        translationUnitId: { default: null },
      },
    },
  },
});

function unitParagraph(id: string, text: string) {
  return unitSchema.node('paragraph', { translationUnitId: id }, unitSchema.text(text));
}

function unitRangeOf(doc: ReturnType<typeof unitSchema.node>, id: string) {
  let range: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.attrs?.translationUnitId === id) {
      range = { from: pos, to: pos + node.nodeSize };
    }
    return undefined;
  });
  return range!;
}

const alignSourceJson = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { translationUnitId: 's1' }, content: [{ type: 'text', text: 'First source sentence.' }] },
    { type: 'paragraph', attrs: { translationUnitId: 's2' }, content: [{ type: 'text', text: 'Second source sentence.' }] },
  ],
};

describe('resolveAlignedUnitRange', () => {
  it('translationUnitId가 일치하면 대응 Target 유닛의 범위를 반환한다', () => {
    const targetDoc = unitSchema.node('doc', null, [
      unitParagraph('s1', '첫 번역 문장.'),
      unitParagraph('s2', '둘째 번역 문장.'),
    ]);

    const range = resolveAlignedUnitRange(targetDoc, alignSourceJson, 'Second source sentence.');

    expect(range).toEqual(unitRangeOf(targetDoc, 's2'));
  });

  it('ID가 독립 발급된 legacy 문서도 1:1 구조면 순번으로 대응한다', () => {
    const targetDoc = unitSchema.node('doc', null, [
      unitParagraph('t1', '첫 번역 문장.'),
      unitParagraph('t2', '둘째 번역 문장.'),
    ]);

    const range = resolveAlignedUnitRange(targetDoc, alignSourceJson, 'Second source sentence.');

    expect(range).toEqual(unitRangeOf(targetDoc, 't2'));
  });

  it('sourceExcerpt가 여러 Source 유닛에 있으면 특정하지 않는다', () => {
    const targetDoc = unitSchema.node('doc', null, [
      unitParagraph('s1', '첫 번역 문장.'),
      unitParagraph('s2', '둘째 번역 문장.'),
    ]);

    expect(resolveAlignedUnitRange(targetDoc, alignSourceJson, 'source sentence.')).toBeNull();
  });

  it('Source 문서나 excerpt가 없으면 null (prior 없이 동작)', () => {
    const targetDoc = unitSchema.node('doc', null, [unitParagraph('s1', '번역.')]);

    expect(resolveAlignedUnitRange(targetDoc, null, 'First source sentence.')).toBeNull();
    expect(resolveAlignedUnitRange(targetDoc, alignSourceJson, undefined)).toBeNull();
    expect(resolveAlignedUnitRange(targetDoc, alignSourceJson, '  ')).toBeNull();
  });
});

describe('resolveSuggestionRange + 유닛 정렬 prior', () => {
  // 반복 구절: prior 없이는 문서 전체 다중 매치 → 모호성 가드로 포기하던 케이스
  const repeatedDoc = unitSchema.node('doc', null, [
    unitParagraph('s1', '공격력이 10 증가합니다.'),
    unitParagraph('s2', '공격력이 10 증가합니다.'),
  ]);

  it('prior가 없으면 반복 구절은 모호성으로 포기한다 (기존 동작 유지)', () => {
    expect(
      resolveSuggestionRange(repeatedDoc, '공격력이 10 증가합니다.', undefined, '공격력이 10 상승합니다.'),
    ).toBeNull();
  });

  it('prior가 있으면 해당 유닛으로 좁혀 반복 구절을 적용할 수 있다', () => {
    const prior = resolveAlignedUnitRange(repeatedDoc, alignSourceJson, 'Second source sentence.');
    expect(prior).not.toBeNull();

    const resolved = resolveSuggestionRange(
      repeatedDoc, '공격력이 10 증가합니다.', undefined, '공격력이 10 상승합니다.', prior,
    );

    const expected = unitRangeOf(repeatedDoc, 's2');
    expect(resolved).not.toBeNull();
    expect(resolved!.fuzzy).toBe(false);
    expect(resolved!.from).toBeGreaterThanOrEqual(expected.from);
    expect(resolved!.to).toBeLessThanOrEqual(expected.to);
  });

  it('prior 범위 안에 excerpt가 없으면 문서 전체 탐색으로 폴백한다', () => {
    const doc = unitSchema.node('doc', null, [
      unitParagraph('s1', '첫 번역 문장.'),
      unitParagraph('s2', '둘째 번역 문장.'),
    ]);
    // 잘못된 prior(첫 유닛)를 줘도 둘째 유닛의 유일 매치를 찾아야 한다
    const wrongPrior = unitRangeOf(doc, 's1');

    const resolved = resolveSuggestionRange(doc, '둘째 번역 문장.', undefined, '둘째 번역 문구.', wrongPrior);

    expect(resolved).not.toBeNull();
    expect(resolved!.from).toBeGreaterThanOrEqual(unitRangeOf(doc, 's2').from);
  });
});
