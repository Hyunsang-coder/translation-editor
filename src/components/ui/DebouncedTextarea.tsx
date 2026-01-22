import { useState, useEffect, useRef, TextareaHTMLAttributes } from 'react';

interface DebouncedTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onDebouncedChange: (value: string) => void;
  debounceDelay?: number;
}

export function DebouncedTextarea({
  value: initialValue,
  onDebouncedChange,
  debounceDelay = 500,
  ...props
}: DebouncedTextareaProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [isTyping, setIsTyping] = useState(false);
  // 브라우저/웹뷰 환경에서는 NodeJS 네임스페이스가 없을 수 있어 setTimeout 반환 타입을 사용합니다.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 외부에서 initialValue가 변경되면 로컬 state도 업데이트 (단, 타이핑 중이 아닐 때만)
  useEffect(() => {
    if (!isTyping) {
      setValue(initialValue);
    }
  }, [initialValue, isTyping]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    setIsTyping(true);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onDebouncedChange(newValue);
      setIsTyping(false);
    }, debounceDelay);
  };

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
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

