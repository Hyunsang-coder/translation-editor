import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewResultsTable } from './ReviewResultsTable';
import type { ReviewIssue } from '@/stores/reviewStore';

function makeIssue(overrides: Partial<ReviewIssue>): ReviewIssue {
  return {
    id: 'issue-1',
    segmentOrder: 0,
    segmentGroupId: undefined,
    sourceExcerpt: '원문 문장입니다.',
    targetExcerpt: 'Incomplete target sentence and offer .',
    suggestedFix: 'Incomplete target sentence and offer their own suggestions.',
    type: 'mistranslation',
    severity: 'major',
    description: '설명',
    checked: true,
    ...overrides,
  };
}

function renderTable(issue: ReviewIssue): void {
  render(
    <ReviewResultsTable
      issues={[issue]}
      onApply={() => undefined}
      onCopy={() => undefined}
      onDelete={() => undefined}
    />,
  );
}

describe('ReviewResultsTable 적용 버튼 노출', () => {
  it('일반 이슈는 적용 버튼이 보인다', () => {
    renderTable(makeIssue({}));
    expect(screen.getByTitle('적용')).toBeTruthy();
  });

  it('부분 누락(targetExcerpt 있음)도 적용 버튼이 보인다', () => {
    renderTable(makeIssue({ type: 'omission' }));
    expect(screen.getByTitle('적용')).toBeTruthy();
  });

  it('완전 누락(targetExcerpt 없음)은 적용 버튼 없이 복사만 보인다', () => {
    renderTable(makeIssue({ type: 'omission', targetExcerpt: '' }));
    expect(screen.queryByTitle('적용')).toBeNull();
    expect(screen.getByTitle('복사')).toBeTruthy();
  });

  it('수정 제안이 없으면 적용 버튼이 없다', () => {
    renderTable(makeIssue({ suggestedFix: '' }));
    expect(screen.queryByTitle('적용')).toBeNull();
  });
});

describe('ReviewResultsTable 수정 제안 표시', () => {
  it('인코딩된 HTML과 Markdown 서식을 제거하고 텍스트만 표시한다', () => {
    renderTable(makeIssue({
      suggestedFix:
        '문서의 &lt;a href=&quot;https://example.com&quot;&gt;부록&lt;/a&gt;과 **[예시](https://example.com/example)**',
    }));

    expect(screen.getByText('문서의 부록과 예시')).toBeTruthy();
    expect(screen.queryByText(/&lt;|<a|href=|\*\*|https:\/\//)).toBeNull();
  });
});
