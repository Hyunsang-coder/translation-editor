/**
 * Headless UI 기반 커스텀 Select 컴포넌트
 *
 * 네이티브 select를 대체하여 일관된 스타일링 제공
 */

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Fragment } from 'react';

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

  // anchor prop 설정 (Headless UI가 자동으로 Portal과 위치 처리)
  const anchorConfig = anchorPosition === 'top'
    ? { to: 'top start' as const, gap: '4px' }
    : { to: 'bottom start' as const, gap: '4px' };

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={`relative ${className}`}>
        <ListboxButton
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

        <ListboxOptions
          anchor={anchorConfig}
          className="z-[9999] max-h-60 overflow-auto
                     rounded-lg border border-editor-border bg-editor-bg shadow-lg
                     focus:outline-none [--anchor-gap:4px]"
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
      </div>
    </Listbox>
  );
}
