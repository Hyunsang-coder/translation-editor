import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConnectorStore } from '@/stores/connectorStore';

describe('ConnectorsSection - Zustand Selector', () => {

  describe('setTokenStatus selector', () => {
    it('selector로 setTokenStatus만 추출할 수 있다', () => {
      const functionSelector = (s: ReturnType<typeof useConnectorStore.getState>) => s.setTokenStatus;

      const { result } = renderHook(() =>
        useConnectorStore(functionSelector)
      );

      expect(typeof result.current).toBe('function');
      expect(result.current).toBeDefined();
    });

    it('setTokenStatus 함수 참조는 불변이다', () => {
      const functionSelector = (s: ReturnType<typeof useConnectorStore.getState>) => s.setTokenStatus;

      const { result: result1 } = renderHook(() =>
        useConnectorStore(functionSelector)
      );
      const { result: result2 } = renderHook(() =>
        useConnectorStore(functionSelector)
      );

      expect(result1.current).toBe(result2.current);
    });

    it('setTokenStatus 호출이 정상 작동한다', () => {
      const store = useConnectorStore.getState();

      // 직접 호출
      store.setTokenStatus('atlassian', true, 1234567890);

      // store 상태 다시 읽기 (persist 변경사항 반영)
      const updated = useConnectorStore.getState();

      expect(updated.tokenMap['atlassian']).toBe(true);
      expect(updated.expiresAtMap['atlassian']).toBe(1234567890);
    });

    it('다른 필드 변경 시 selector 사용 컴포넌트는 리렌더 안된다', () => {
      const renderCount = { current: 0 };

      renderHook(() => {
        renderCount.current++;
        return useConnectorStore((s: ReturnType<typeof useConnectorStore.getState>) => s.setTokenStatus);
      });

      const initialRenderCount = renderCount.current;

      act(() => {
        const store = useConnectorStore.getState();
        store.setEnabled('openai', true);
      });

      expect(renderCount.current).toBe(initialRenderCount);
    });
  });
});
