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

describe('ReviewResultsTable 글자 크기 계층', () => {
  it('완료 안내는 다른 패널의 빈 상태와 같은 크기를 사용한다', () => {
    render(<ReviewResultsTable issues={[]} />);

    expect(screen.getByText('오역이나 누락이 발견되지 않았습니다.')).toHaveClass('text-sm');
  });

  it('카드 순번은 다른 메타 정보와 같은 크기를 사용한다', () => {
    renderTable(makeIssue({}));

    expect(screen.getByText('1')).toHaveClass('text-[10px]');
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

describe('ReviewResultsTable 이슈 위치 이동', () => {
  function renderNavigable(overrides: {
    onNavigate?: (issueId: string) => void;
    issues?: ReviewIssue[];
    severityFilter?: ReviewIssue['severity'][];
  } = {}) {
    return render(
      <ReviewResultsTable
        issues={overrides.issues ?? [makeIssue({})]}
        onApply={() => undefined}
        onCopy={() => undefined}
        onIgnore={() => undefined}
        onToggleCheck={() => undefined}
        onNavigate={overrides.onNavigate ?? (() => undefined)}
        {...(overrides.severityFilter ? { severityFilter: overrides.severityFilter } : {})}
      />,
    );
  }

  it('카드에 data-issue-id가 있다', () => {
    renderNavigable();

    expect(screen.getByTestId('review-issue-card').getAttribute('data-issue-id'))
      .toBe('issue-1');
  });

  it('카드를 클릭하면 해당 이슈 ID로 이동을 요청한다', () => {
    const onNavigate = vi.fn();
    renderNavigable({ onNavigate });

    fireEvent.click(screen.getByTestId('review-issue-card'));

    expect(onNavigate).toHaveBeenCalledWith('issue-1');
  });

  it('키보드 Enter/Space도 같은 이동을 실행한다', () => {
    const onNavigate = vi.fn();
    renderNavigable({ onNavigate });
    const card = screen.getByTestId('review-issue-card');

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });

    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('카드 안 구절을 드래그 선택하는 중에는 이동하지 않는다', () => {
    const onNavigate = vi.fn();
    renderNavigable({ onNavigate });
    const card = screen.getByTestId('review-issue-card');

    const range = document.createRange();
    range.selectNodeContents(card);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.click(card);

    expect(onNavigate).not.toHaveBeenCalled();
    selection.removeAllRanges();
  });

  it('적용·복사·무시·체크박스 조작은 카드 이동을 함께 실행하지 않는다', () => {
    const onNavigate = vi.fn();
    renderNavigable({ onNavigate });

    fireEvent.click(screen.getByTitle('적용'));
    fireEvent.click(screen.getByTitle('복사'));
    fireEvent.click(screen.getByTitle('무시'));
    fireEvent.click(screen.getByLabelText('이슈 선택'));

    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('ReviewResultsTable 카드 목록 이동 요청', () => {
  function stubRect(el: Element, top: number): void {
    el.getBoundingClientRect = (): DOMRect => ({ top } as DOMRect);
  }

  function renderWithPending(issues: ReviewIssue[], onHandled: (id: number) => void) {
    return render(
      <ReviewResultsTable
        issues={issues}
        onNavigate={() => undefined}
        pendingScrollIssue={null}
        onPendingScrollHandled={onHandled}
      />,
    );
  }

  it('목록 컨테이너만 스크롤해 대상 카드를 보이게 하고 요청을 소비한다', () => {
    const onHandled = vi.fn();
    const { container, rerender } = renderWithPending([makeIssue({})], onHandled);

    const list = container.querySelector('.overflow-y-auto') as HTMLElement;
    const card = screen.getByTestId('review-issue-card');
    const header = container.querySelector('[data-review-list-header]') as HTMLElement;
    stubRect(list, 100);
    stubRect(card, 500);
    // sticky "전체 선택" 헤더가 목록 최상단을 가리므로 그 높이만큼 더 내려야 한다
    Object.defineProperty(header, 'offsetHeight', { value: 34, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true });
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    rerender(
      <ReviewResultsTable
        issues={[makeIssue({})]}
        onNavigate={() => undefined}
        pendingScrollIssue={{ issueId: 'issue-1', requestId: 7 }}
        onPendingScrollHandled={onHandled}
      />,
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 500 - 100 - (34 + 8), behavior: 'smooth' });
    expect(onHandled).toHaveBeenCalledWith(7);
  });

  it('필터로 숨겨진 카드는 이동하지 않지만 요청은 소비한다 (stale 방지)', () => {
    const onHandled = vi.fn();
    const hidden = makeIssue({ id: 'issue-hidden', severity: 'minor' });

    render(
      <ReviewResultsTable
        issues={[makeIssue({}), hidden]}
        severityFilter={['major']}
        onNavigate={() => undefined}
        pendingScrollIssue={{ issueId: 'issue-hidden', requestId: 9 }}
        onPendingScrollHandled={onHandled}
      />,
    );

    expect(screen.queryByText(/issue-hidden/)).toBeNull();
    expect(onHandled).toHaveBeenCalledWith(9);
  });
});
