/**
 * 검수 하이라이트/적용 통합 테스트
 *
 * 실제 앱 구성요소로 사용자 시나리오를 재현:
 * 실제 에디터(StarterKit, HTML 파싱) + parseReviewResult
 * → createReviewDecorations (하이라이트) → applySuggestionToEditor (적용)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { createReviewDecorations } from '@/editor/extensions/ReviewHighlight';
import { AppliedChangeHighlight } from '@/editor/extensions/AppliedChangeHighlight';
import { TranslationUnitId } from '@/editor/extensions/TranslationUnitId';
import { applySuggestionToEditor } from '@/components/review/reviewApply';
import type { ReviewIssue } from '@/stores/reviewStore';

// 스크린샷과 동일한 구조: 문단 + 불릿리스트 (실제 에디터 스키마에는 segmentGroupId attr 없음)
const TARGET_HTML = [
  '<p>At this competency level, engineers are expected to accurately understand problems by reviewing structured materials and task explanations, and to establish reasonable plans for completing them.</p>',
  '<ul>',
  '<li><p>Can distinguish what they do and do not know about the assigned task and solution, and ask questions to clarify the areas they need to understand.</p></li>',
  '<li><p>Can accurately understand the given problem and solution when executing the task, well enough to explain them.</p></li>',
  '</ul>',
].join('');

// 새 프롬프트 형식의 AI 응답 (곡선 따옴표 + 문서에 없는 SegmentGroupId 포함)
const AI_RESPONSE = `
---REVIEW_START---
## Translation Review Result

### Issue #1
- **Source**: “업무를 수행하는 시점에 제시된 문제 및 해결 방법을 설명 가능한 수준으로 정확하게 이해할 수 있다.”
- **Target**: “Can accurately understand the given problem and solution when executing the task, well enough to explain them.”
- **Type**: Awkward
- **Severity**: 2
- **SegmentGroupId**: seg-002
- **Explanation**: 번역투입니다
- **Suggestion**: “Can understand the given problem and solution well enough to explain them at the time of performing the task.”

## Summary
- Verdict: MINOR REVISIONS
---REVIEW_END---
`;

/** Target 라인만 교체한 AI 응답 생성 */
function responseWithTarget(targetLine: string): string {
  return AI_RESPONSE.replace(/- \*\*Target\*\*: .*$/m, `- **Target**: "${targetLine}"`);
}

describe('검수 통합: 파싱 → 하이라이트 → 적용', () => {
  let editor: Editor | null = null;

  function createRealEditor(): Editor {
    editor = new Editor({ extensions: [StarterKit, AppliedChangeHighlight], content: TARGET_HTML });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('새 프롬프트 형식 응답이 파싱되고 곡선 따옴표는 원본 보존된다 (F6: 벗기기는 적용 단계로 지연)', () => {
    const issues = parseReviewResult(AI_RESPONSE);

    expect(issues).toHaveLength(1);
    // F6: parse 단계에서는 곡선 따옴표를 벗기지 않고 원문을 보존한다.
    // (실제 벗기기 여부는 적용 시 문서 컨텍스트로 판단 — resolveReplacementText)
    expect(issues[0]!.targetExcerpt).toBe(
      '\u201cCan accurately understand the given problem and solution when executing the task, well enough to explain them.\u201d',
    );
    expect(issues[0]!.suggestedFix).toBe(
      '\u201cCan understand the given problem and solution well enough to explain them at the time of performing the task.\u201d',
    );
  });

  it('파싱된 이슈가 실제 에디터 문서에서 하이라이트된다', () => {
    const issues = parseReviewResult(AI_RESPONSE);
    const doc = createRealEditor().state.doc;

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');

    expect(decorations.find()).toHaveLength(1);
  });

  it('여러 블록(불릿)에 걸친 excerpt도 하이라이트된다', () => {
    const doc = createRealEditor().state.doc;
    const issues = parseReviewResult(responseWithTarget(
      'Can distinguish what they do and do not know about the assigned task and solution, and ask questions to clarify the areas they need to understand. Can accurately understand the given problem and solution when executing the task, well enough to explain them.',
    ));

    const decorations = createReviewDecorations(doc, issues, 'review-highlight', 'targetExcerpt');

    expect(decorations.find()).toHaveLength(1);
  });

  it('적용 시 해당 문장이 제안으로 교체된다', () => {
    const issues = parseReviewResult(AI_RESPONSE);
    const realEditor = createRealEditor();

    const status = applySuggestionToEditor(realEditor, issues[0]!);

    expect(status).toBe('applied');
    const text = realEditor.getText();
    expect(text).toContain('at the time of performing the task');
    expect(text).not.toContain('when executing the task, well enough');
    // 다른 문장은 그대로
    expect(text).toContain('Can distinguish what they do and do not know');
    const highlight = realEditor.view.dom.querySelector('[data-applied-change]');
    expect(highlight?.textContent).toContain('at the time of performing the task');
  });

  it('excerpt가 문서와 조금 달라도 유사 문장 폴백으로 적용된다', () => {
    const issues = parseReviewResult(responseWithTarget(
      // 어순이 다른 패러프레이즈 (정확 매치 불가)
      'Can understand the given problem and solution accurately, well enough to explain them while executing the task.',
    ));
    const realEditor = createRealEditor();

    const status = applySuggestionToEditor(realEditor, issues[0]!);

    expect(status).toBe('applied-fuzzy');
    expect(realEditor.getText()).toContain('at the time of performing the task');
  });
});

describe('검수 적용: 표 셀', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  async function createTableEditor(html: string): Promise<Editor> {
    editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TranslationUnitId,
        AppliedChangeHighlight,
      ],
      content: html,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return editor;
  }

  function issue(overrides: Partial<ReviewIssue>): ReviewIssue {
    return {
      id: 'issue-1',
      segmentOrder: 0,
      segmentGroupId: undefined,
      sourceExcerpt: 'Alpha source.',
      targetExcerpt: '알파 번역.',
      suggestedFix: '알파 수정.',
      type: 'awkward',
      severity: 'minor',
      description: 'test',
      checked: false,
      ...overrides,
    };
  }

  it('표 셀의 유일한 excerpt는 그 셀만 교체하고 옆 셀은 그대로 둔다', async () => {
    const ed = await createTableEditor(
      '<table><tbody><tr>' +
        '<td><p>알파 번역.</p></td>' +
        '<td><p>베타 번역.</p></td>' +
        '</tr></tbody></table>',
    );

    expect(applySuggestionToEditor(ed, issue({}))).toBe('applied');
    const json = JSON.stringify(ed.getJSON());
    expect(json).toContain('알파 수정.');
    expect(json).toContain('베타 번역.');
    expect(json).not.toContain('알파 번역.');
  });

  it('같은 번역이 여러 셀에 있으면 원문 정렬 prior로 해당 셀만 고친다', async () => {
    const ed = await createTableEditor(
      '<table><tbody><tr>' +
        '<td><p>같은 번역.</p></td>' +
        '<td><p>같은 번역.</p></td>' +
        '</tr></tbody></table>',
    );
    const sourceDoc = {
      type: 'doc',
      content: [{
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { translationUnitId: 's1' },
              content: [{
                type: 'paragraph',
                attrs: { translationUnitId: 's1p' },
                content: [{ type: 'text', text: 'First source.' }],
              }],
            },
            {
              type: 'tableCell',
              attrs: { translationUnitId: 's2' },
              content: [{
                type: 'paragraph',
                attrs: { translationUnitId: 's2p' },
                content: [{ type: 'text', text: 'Second source.' }],
              }],
            },
          ],
        }],
      }],
    };

    expect(
      applySuggestionToEditor(ed, issue({
        sourceExcerpt: 'Second source.',
        targetExcerpt: '같은 번역.',
        suggestedFix: '둘째 셀 수정.',
      }), sourceDoc),
    ).toBe('applied');

    const cells: string[] = [];
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell') cells.push(node.textContent);
    });
    expect(cells).toEqual(['같은 번역.', '둘째 셀 수정.']);
  });
});
