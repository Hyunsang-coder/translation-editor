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
import { parseReviewResult } from '@/ai/review/parseReviewResult';
import { createReviewDecorations } from '@/editor/extensions/ReviewHighlight';
import { applySuggestionToEditor } from '@/components/review/reviewApply';

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
    editor = new Editor({ extensions: [StarterKit], content: TARGET_HTML });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('새 프롬프트 형식 응답이 파싱되고 따옴표가 제거된다', () => {
    const issues = parseReviewResult(AI_RESPONSE);

    expect(issues).toHaveLength(1);
    expect(issues[0]!.targetExcerpt).toBe(
      'Can accurately understand the given problem and solution when executing the task, well enough to explain them.',
    );
    expect(issues[0]!.suggestedFix).toBe(
      'Can understand the given problem and solution well enough to explain them at the time of performing the task.',
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
