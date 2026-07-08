import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createReviewDecorations, ReviewHighlight } from './ReviewHighlight';
import { findSegmentRange } from './SearchHighlight';
import { pluginKeys } from '@/editor/plugins/pluginKeys';
import { useReviewStore, type IssueType, type IssueSeverity } from '@/stores/reviewStore';

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

describe('ReviewHighlight segment range', () => {
  it('segmentGroupId가 있으면 해당 범위 내 매치만 하이라이트', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: 'seg-2',
        sourceExcerpt: '',
        targetExcerpt: 'Hello world',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    const rangeSeg2 = findSegmentRange(doc, 'seg-2');
    expect(rangeSeg2).not.toBeNull();
    expect(found).toHaveLength(1);
    expect(found[0]?.from).toBeGreaterThanOrEqual(rangeSeg2!.from);
    expect(found[0]?.to).toBeLessThanOrEqual(rangeSeg2!.to);
  });

  it('segmentGroupId가 문서에 없으면 하이라이트하지 않는다', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: 'missing-seg',
        sourceExcerpt: '',
        targetExcerpt: 'Hello world',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    expect(found).toHaveLength(0);
  });

  it('문서에 segmentGroupId가 없으면 segmentGroupId가 있어도 하이라이트한다', () => {
    const plainSchema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        text: { group: 'inline' },
        paragraph: {
          group: 'block',
          content: 'inline*',
        },
      },
    });
    const doc = plainSchema.node('doc', null, [
      plainSchema.node('paragraph', null, plainSchema.text('Hello world')),
    ]);
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: 'seg-1',
        sourceExcerpt: '',
        targetExcerpt: 'Hello world',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    expect(found).toHaveLength(1);
  });

  it('동일 문구가 여러 번 있어도 segment 범위 내 하이라이트를 유지한다', () => {
    const doc = buildDoc('Hello world', 'Hello world Hello world');
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: 'seg-2',
        sourceExcerpt: '',
        targetExcerpt: 'Hello world',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    const rangeSeg2 = findSegmentRange(doc, 'seg-2');
    expect(rangeSeg2).not.toBeNull();
    expect(found).toHaveLength(1);
    expect(found[0]?.from).toBeGreaterThanOrEqual(rangeSeg2!.from);
    expect(found[0]?.to).toBeLessThanOrEqual(rangeSeg2!.to);
  });

  it('정규화 후 빈 문자열이면 하이라이트하지 않는다', () => {
    const doc = buildDoc('Hello world', 'Hello world');
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: 'seg-1',
        sourceExcerpt: '',
        targetExcerpt: '<strong></strong>',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    expect(found).toHaveLength(0);
  });

  it('segmentGroupId 없이 동일 문구가 여러 곳이면 모호 → 하이라이트하지 않는다 (F2)', () => {
    // 이전에는 첫 매치를 하이라이트했으나, 위치를 특정할 수 없는 모호한 이슈이므로
    // 이제 apply/하이라이트 모두 포기한다 (구 filterMatchesBySegment 시맨틱 복원).
    const doc = buildDoc('Hello world', 'Hello world');
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: undefined,
        sourceExcerpt: '',
        targetExcerpt: 'Hello world',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    expect(found).toHaveLength(0);
  });

  it('segmentGroupId 없이 유일한 매치는 하이라이트한다 (F2)', () => {
    const doc = buildDoc('Hello world', 'Second paragraph');
    const issues = [
      {
        id: 'issue-1',
        segmentOrder: 1,
        segmentGroupId: undefined,
        sourceExcerpt: '',
        targetExcerpt: 'Hello world',
        suggestedFix: '',
        type: 'mistranslation' as IssueType,
        severity: 'major' as IssueSeverity,
        description: '',
        checked: true,
      },
    ];

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');
    const found = decorations.find();

    const rangeSeg1 = findSegmentRange(doc, 'seg-1');
    expect(rangeSeg1).not.toBeNull();
    expect(found).toHaveLength(1);
    expect(found[0]?.from).toBeGreaterThanOrEqual(rangeSeg1!.from);
    expect(found[0]?.to).toBeLessThanOrEqual(rangeSeg1!.to);
  });
});

describe('ReviewHighlight 편집 디바운스 (P2: 키 입력당 재계산 방지)', () => {
  let editor: Editor | null = null;
  // getAllIssues 캐시(cachedNonce)와 절대 충돌하지 않도록 테스트 전용 nonce를 계속 증가시킴
  let testNonce = 100000;

  const issue = {
    id: 'issue-1',
    segmentOrder: 1,
    segmentGroupId: undefined,
    sourceExcerpt: '',
    targetExcerpt: 'Hello world',
    suggestedFix: '',
    type: 'mistranslation' as IssueType,
    severity: 'major' as IssueSeverity,
    description: '',
    checked: true,
  };

  function createEditor(): Editor {
    editor = new Editor({
      extensions: [StarterKit, ReviewHighlight],
      content: '<p>Hello world</p><p>Other text here</p>',
    });
    return editor;
  }

  function decorationCount(ed: Editor): number {
    return pluginKeys.reviewHighlight.getState(ed.state)?.find().length ?? 0;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    useReviewStore.setState({
      highlightEnabled: true,
      severityFilter: ['critical', 'major', 'minor'],
      results: [{ chunkIndex: 0, issues: [issue] }],
      isReviewing: false,
      highlightNonce: ++testNonce,
    });
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    vi.useRealTimers();
    useReviewStore.setState({
      highlightEnabled: false,
      results: [],
      highlightNonce: ++testNonce,
    });
  });

  it('편집 직후에는 기존 데코레이션을 매핑만 유지하고, 디바운스 후 전체 재계산한다', () => {
    const ed = createEditor();
    expect(decorationCount(ed)).toBe(1);

    // 하이라이트된 excerpt 내부에 텍스트 삽입 → "HelXlo world" (더 이상 매치 불가)
    ed.commands.insertContentAt(4, 'X');

    // 편집 직후: 전체 재계산 없이 위치 매핑만 → 데코레이션은 아직 유지
    expect(decorationCount(ed)).toBe(1);

    // 디바운스(300ms) 경과 → 전체 재계산 → 깨진 excerpt는 제거됨
    vi.advanceTimersByTime(300);
    expect(decorationCount(ed)).toBe(0);
  });

  it('하이라이트 범위 밖 편집은 디바운스 재계산 후에도 데코레이션이 유지된다', () => {
    const ed = createEditor();
    expect(decorationCount(ed)).toBe(1);

    // 두 번째 문단 끝에 텍스트 추가 (excerpt는 그대로)
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' more');
    expect(decorationCount(ed)).toBe(1);

    vi.advanceTimersByTime(300);
    expect(decorationCount(ed)).toBe(1);
  });

  it('연속 편집 중에는 재계산이 마지막 편집 후 한 번만 일어난다 (타이머 리셋)', () => {
    const ed = createEditor();
    expect(decorationCount(ed)).toBe(1);

    ed.commands.insertContentAt(4, 'X');
    vi.advanceTimersByTime(200); // 디바운스 미도달
    ed.commands.insertContentAt(5, 'Y');
    vi.advanceTimersByTime(200); // 타이머 리셋 후 다시 미도달

    // 아직 재계산 전 → 매핑된 데코레이션 유지
    expect(decorationCount(ed)).toBe(1);

    vi.advanceTimersByTime(100); // 마지막 편집 기준 300ms 경과
    expect(decorationCount(ed)).toBe(0);
  });
});
