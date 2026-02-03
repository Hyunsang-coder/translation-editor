import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { createReviewDecorations } from './ReviewHighlight';
import { findSegmentRange } from './SearchHighlight';
import type { IssueType, IssueSeverity } from '@/stores/reviewStore';

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

  it('segmentGroupId가 없으면 첫 매치를 하이라이트', () => {
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

    const rangeSeg1 = findSegmentRange(doc, 'seg-1');
    expect(rangeSeg1).not.toBeNull();
    expect(found).toHaveLength(1);
    expect(found[0]?.from).toBeGreaterThanOrEqual(rangeSeg1!.from);
    expect(found[0]?.to).toBeLessThanOrEqual(rangeSeg1!.to);
  });
});
