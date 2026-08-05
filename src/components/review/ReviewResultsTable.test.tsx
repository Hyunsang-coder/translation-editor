import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewResultsTable } from './ReviewResultsTable';
import type { ReviewIssue } from '@/stores/reviewStore';
import ko from '@/i18n/locales/ko.json';

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

function renderTable(issue: ReviewIssue, onIgnore = () => undefined): void {
  render(
    <ReviewResultsTable
      issues={[issue]}
      onApply={() => undefined}
      onCopy={() => undefined}
      onIgnore={onIgnore}
      onViewInDocument={() => undefined}
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

describe('ReviewResultsTable 본문에서 보기', () => {
  it('targetExcerpt가 있으면 본문에서 보기가 보인다', () => {
    renderTable(makeIssue({}));
    expect(screen.getByTitle('본문에서 보기')).toBeTruthy();
  });

  it('targetExcerpt가 없으면 탐색 앵커가 없어 숨긴다', () => {
    renderTable(makeIssue({ targetExcerpt: '' }));
    expect(screen.queryByTitle('본문에서 보기')).toBeNull();
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

describe('ReviewResultsTable 무시 동작', () => {
  it('확인이 아닌 무시로 표시한다', () => {
    renderTable(makeIssue({}));

    expect(ko.review.ignore).toBe('무시');
    expect(screen.getByRole('button', { name: '무시' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '확인' })).toBeNull();
  });

  it('수정 제안이 없어도 검수 항목을 무시할 수 있다', () => {
    renderTable(makeIssue({ suggestedFix: '' }));

    expect(screen.getByRole('button', { name: '무시' })).toBeTruthy();
  });

  it('무시하면 해당 이슈 ID를 전달한다', () => {
    const onIgnore = vi.fn();
    renderTable(makeIssue({ id: 'ignored-issue' }), onIgnore);

    fireEvent.click(screen.getByRole('button', { name: '무시' }));

    expect(onIgnore).toHaveBeenCalledWith('ignored-issue');
  });
});

describe('ReviewResultsTable 문서 순서', () => {
  it('심각도와 관계없이 문서 위쪽 세그먼트부터 표시한다', () => {
    render(
      <ReviewResultsTable
        issues={[
          makeIssue({
            id: 'critical-late',
            segmentOrder: 30,
            severity: 'critical',
            targetExcerpt: '문서 하단 문장',
          }),
          makeIssue({
            id: 'minor-early',
            segmentOrder: 10,
            severity: 'minor',
            targetExcerpt: '문서 초반 문장',
          }),
          makeIssue({
            id: 'major-middle',
            segmentOrder: 20,
            severity: 'major',
            targetExcerpt: '문서 중간 문장',
          }),
        ]}
      />,
    );

    const cards = screen.getAllByTestId('review-issue-card');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('문서 초반 문장'),
      expect.stringContaining('문서 중간 문장'),
      expect.stringContaining('문서 하단 문장'),
    ]);
  });

  it('같은 세그먼트의 이슈는 AI가 반환한 순서를 유지한다', () => {
    render(
      <ReviewResultsTable
        issues={[
          makeIssue({ id: 'same-1', segmentOrder: 10, targetExcerpt: '첫 번째 이슈' }),
          makeIssue({ id: 'same-2', segmentOrder: 10, targetExcerpt: '두 번째 이슈' }),
        ]}
      />,
    );

    const cards = screen.getAllByTestId('review-issue-card');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('첫 번째 이슈'),
      expect.stringContaining('두 번째 이슈'),
    ]);
  });
});
