import { useState, useEffect, useRef, TextareaHTMLAttributes } from 'react';

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

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onDebouncedChange(newValue);
      setIsTyping(false);
    }, debounceDelay);
  };

  // 컴포넌트 언마운트 시 타이머 정리 + pending 값 flush
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Flush pending value on unmount
        onDebouncedChangeRef.current(latestValueRef.current);
      }
    };
  }, []);

  return (
    <textarea
      {...props}
      value={value}
      onChange={handleChange}
    />
  );
}

