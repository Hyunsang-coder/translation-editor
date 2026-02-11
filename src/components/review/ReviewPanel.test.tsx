import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReviewStore } from '@/stores/reviewStore';

describe('ReviewPanel - Zustand Selectors', () => {
  beforeEach(() => {
    // 각 테스트 전 store 초기화
    useReviewStore.setState({
      severityFilter: ['critical', 'major'],
      chunks: [],
      currentChunkIndex: 0,
      results: [],
      isReviewing: false,
      progress: { completed: 0, total: 0 },
      highlightEnabled: false,
      highlightNonce: 0,
      initializedProjectId: null,
      totalIssuesFound: 0,
      streamingText: '',
      reviewTrigger: 0,
    });
  });

  describe('streamingText 필드 selector', () => {
    it('streamingText만 구독하면 다른 필드 변경 시 리렌더 안된다', () => {
      const renderCount = { current: 0 };
      const streamingTextSelector = (s: ReturnType<typeof useReviewStore.getState>) => s.streamingText;

      const { result } = renderHook(
        () => {
          renderCount.current++;
          return useReviewStore(streamingTextSelector);
        }
      );

      const initialRenderCount = renderCount.current;

      act(() => {
        useReviewStore.setState({ severityFilter: ['critical'] });
      });

      expect(renderCount.current).toBe(initialRenderCount);
      expect(result.current).toBe('');
    });

    it('streamingText 변경 시 리렌더된다', () => {
      const renderCount = { current: 0 };

      const { result } = renderHook(
        () => {
          renderCount.current++;
          return useReviewStore((s) => s.streamingText);
        }
      );

      const initialRenderCount = renderCount.current;

      act(() => {
        useReviewStore.setState({ streamingText: 'new text' });
      });

      expect(renderCount.current).toBeGreaterThan(initialRenderCount);
      expect(result.current).toBe('new text');
    });
  });

  describe('액션 함수 selector', () => {
    it('액션 함수는 매번 같은 참조를 유지한다', () => {
      const functionSelector = (s: ReturnType<typeof useReviewStore.getState>) => s.startReview;

      const { result: result1 } = renderHook(() =>
        useReviewStore(functionSelector)
      );
      const { result: result2 } = renderHook(() =>
        useReviewStore(functionSelector)
      );

      expect(result1.current).toBe(result2.current);
    });
  });
});
