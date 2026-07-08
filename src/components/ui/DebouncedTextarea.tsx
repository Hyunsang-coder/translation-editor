import { useState, useEffect, useRef, useCallback, TextareaHTMLAttributes } from 'react';

/**
 * Safe Exit 등에서 디바운스 대기 중인 값을 즉시 커밋시키기 위한 전역 flush 이벤트 이름.
 * 모든 DebouncedTextarea 인스턴스가 이 이벤트를 수신해 pending 값을 즉시 flush합니다.
 */
export const DEBOUNCED_FIELDS_FLUSH_EVENT = 'oddeyes:flush-debounced-fields';

/**
 * 마운트된 모든 DebouncedTextarea의 pending 값을 즉시 flush합니다.
 * (C3: 창 닫기 직전 debounce 대기분 유실 방지. App의 Safe Exit 핸들러에서 호출)
 */
export function flushDebouncedFields(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DEBOUNCED_FIELDS_FLUSH_EVENT));
}

interface DebouncedTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onDebouncedChange: (value: string) => void;
  debounceDelay?: number;
  /**
   * 매 입력마다(디바운스 없이) 즉시 호출. 리렌더를 유발하지 않는 ref 갱신 등
   * "최신 값"이 디바운스 지연 없이 필요한 소비자를 위한 훅.
   */
  onLiveChange?: (value: string) => void;
}

export function DebouncedTextarea({
  value: initialValue,
  onDebouncedChange,
  debounceDelay = 500,
  onLiveChange,
  ...props
}: DebouncedTextareaProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [isTyping, setIsTyping] = useState(false);
  // 브라우저/웹뷰 환경에서는 NodeJS 네임스페이스가 없을 수 있어 setTimeout 반환 타입을 사용합니다.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 아직 onDebouncedChange로 커밋되지 않은 입력이 있는지 (타이머 발화 후 stale flush 방지)
  const hasPendingRef = useRef(false);
  const latestValueRef = useRef(initialValue);
  const onDebouncedChangeRef = useRef(onDebouncedChange);
  onDebouncedChangeRef.current = onDebouncedChange;

  // 외부에서 initialValue가 변경되면 로컬 state도 업데이트 (단, 타이핑 중이 아닐 때만)
  useEffect(() => {
    if (!isTyping) {
      setValue(initialValue);
    }
  }, [initialValue, isTyping]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    latestValueRef.current = newValue;
    onLiveChange?.(newValue);
    setIsTyping(true);
    hasPendingRef.current = true;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      hasPendingRef.current = false;
      onDebouncedChangeRef.current(newValue);
      setIsTyping(false);
    }, debounceDelay);
  };

  // pending 입력이 있으면 디바운스를 기다리지 않고 즉시 커밋
  const flushPending = useCallback((): void => {
    if (!hasPendingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    hasPendingRef.current = false;
    onDebouncedChangeRef.current(latestValueRef.current);
    setIsTyping(false);
  }, []);

  // C3: Safe Exit 등 외부 flush 신호 수신 시 즉시 커밋 (창 닫기는 unmount가 발생하지 않음)
  useEffect(() => {
    const handler = (): void => flushPending();
    window.addEventListener(DEBOUNCED_FIELDS_FLUSH_EVENT, handler);
    return () => window.removeEventListener(DEBOUNCED_FIELDS_FLUSH_EVENT, handler);
  }, [flushPending]);

  // 언마운트 시 pending 값 flush
  // (프로젝트 전환은 key={projectId} remount로 언마운트가 발생하므로 이 경로로 flush됨)
  useEffect(() => {
    return () => flushPending();
  }, [flushPending]);

  return (
    <textarea
      {...props}
      value={value}
      onChange={handleChange}
    />
  );
}
