import { useEffect, useRef, useCallback, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** aria-labelledby target id */
  labelId?: string;
  /** 오버레이 클릭 닫기 허용 (기본 true) */
  closeOnOverlay?: boolean;
  /** ESC 키 닫기 허용 (기본 true) */
  closeOnEsc?: boolean;
  /** 오버레이 클래스 */
  className?: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 공통 모달 래퍼
 * - role="dialog" + aria-modal
 * - Focus trap (Tab/Shift+Tab 순환)
 * - 초기 포커스 → 첫 번째 focusable 요소
 * - ESC 키 닫기
 * - 오버레이 클릭 닫기
 */
export function Modal({
  open,
  onClose,
  labelId,
  closeOnOverlay = true,
  closeOnEsc = true,
  className = '',
  children,
}: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 열릴 때 이전 포커스 저장 + 초기 포커스 설정
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // 약간의 딜레이로 DOM이 렌더된 후 포커스
    const timer = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else {
        dialog.focus();
      }
    });

    return () => cancelAnimationFrame(timer);
  }, [open]);

  // 닫힐 때 이전 포커스 복원
  useEffect(() => {
    if (open) return;
    previousFocusRef.current?.focus();
  }, [open]);

  // ESC 키 핸들링
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, closeOnEsc, onClose]);

  // Focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  // 오버레이 클릭 닫기
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlay && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlay, onClose],
  );

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="contents"
      >
        {children}
      </div>
    </div>
  );
}
