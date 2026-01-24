/**
 * Headless UI 기반 커스텀 Select 컴포넌트
 *
 * 네이티브 select를 대체하여 일관된 스타일링 제공
 */

import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Portal } from '@headlessui/react';
import { Fragment, useRef, useState, useLayoutEffect } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[] | SelectOptionGroup[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  title?: string;
  size?: 'sm' | 'md';
  /** 드롭다운 열림 방향: 'bottom' (기본) 또는 'top' */
  anchor?: 'bottom' | 'top';
}

function isOptionGroup(item: SelectOption | SelectOptionGroup): item is SelectOptionGroup {
  return 'options' in item;
}

function hasGroups(options: SelectOption[] | SelectOptionGroup[]): options is SelectOptionGroup[] {
  if (options.length === 0) return false;
  const first = options[0];
  return first !== undefined && isOptionGroup(first);
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  placeholder,
  className = '',
  'aria-label': ariaLabel,
  title,
  size = 'md',
  anchor: anchorPosition = 'bottom',
}: SelectProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // 버튼 위치 계산
  useLayoutEffect(() => {
    if (isOpen && buttonRef.current) {
      setButtonRect(buttonRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  // 현재 선택된 옵션의 label 찾기
  const getSelectedLabel = (): string => {
    if (hasGroups(options)) {
      for (const group of options) {
        const found = group.options.find((opt) => opt.value === value);
        if (found) return found.label;
      }
    } else {
      const found = options.find((opt) => opt.value === value);
      if (found) return found.label;
    }
    return placeholder || '';
  };

  const sizeClasses = size === 'sm'
    ? 'h-7 text-[11px] px-2'
    : 'h-8 text-[11px] px-3';

  // 드롭다운 위치 스타일 계산
  const getDropdownStyle = (): React.CSSProperties => {
    if (!buttonRect) return {};

    const style: React.CSSProperties = {
      position: 'fixed',
      left: buttonRect.left,
      minWidth: buttonRect.width,
    };

    if (anchorPosition === 'top') {
      style.bottom = window.innerHeight - buttonRect.top + 4;
    } else {
      style.top = buttonRect.bottom + 4;
    }

    return style;
  };

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {({ open }) => {
        // open 상태 동기화
        if (open !== isOpen) {
          // 다음 틱에 상태 업데이트 (렌더 중 setState 방지)
          setTimeout(() => setIsOpen(open), 0);
        }

        return (
          <div className={`relative ${className}`}>
            <ListboxButton
              ref={buttonRef}
              className={`${sizeClasses} w-full rounded-lg border border-editor-border bg-editor-bg text-editor-text
                         flex items-center justify-between gap-2
                         focus:outline-none focus:ring-2 focus:ring-primary-500
                         disabled:opacity-50 disabled:cursor-not-allowed
                         hover:bg-editor-surface transition-colors`}
              aria-label={ariaLabel}
              title={title}
            >
              <span className="truncate">{getSelectedLabel()}</span>
              <svg
                className="w-3 h-3 text-editor-muted shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </ListboxButton>

            <Portal>
              <ListboxOptions
                className="z-[9999] max-h-60 overflow-auto
                           rounded-lg border border-editor-border bg-editor-bg shadow-lg
                           focus:outline-none"
                style={getDropdownStyle()}
              >
          {hasGroups(options) ? (
            options.map((group) => (
              <Fragment key={group.label}>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-editor-muted uppercase tracking-wider bg-editor-surface">
                  {group.label}
                </div>
                {group.options.map((option) => (
                  <ListboxOption
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled ?? false}
                    className="group flex items-center gap-2 px-3 py-1.5 text-[11px] text-editor-text
                               cursor-pointer select-none
                               data-[focus]:bg-primary-100 dark:data-[focus]:bg-primary-900
                               data-[selected]:text-primary-600 dark:data-[selected]:text-primary-400
                               data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                  >
                    <span className="w-3 shrink-0">
                      <span className="hidden group-data-[selected]:inline text-primary-500">✓</span>
                    </span>
                    <span className="truncate">{option.label}</span>
                  </ListboxOption>
                ))}
              </Fragment>
            ))
          ) : (
            options.map((option) => (
              <ListboxOption
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className="group flex items-center gap-2 px-3 py-1.5 text-[11px] text-editor-text
                           cursor-pointer select-none
                           data-[focus]:bg-primary-100 dark:data-[focus]:bg-primary-900
                           data-[selected]:text-primary-600 dark:data-[selected]:text-primary-400
                           data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              >
                <span className="w-3 shrink-0">
                  <span className="hidden group-data-[selected]:inline text-primary-500">✓</span>
                </span>
                <span className="truncate">{option.label}</span>
              </ListboxOption>
            ))
          )}
              </ListboxOptions>
            </Portal>
          </div>
        );
      }}
    </Listbox>
  );
}
