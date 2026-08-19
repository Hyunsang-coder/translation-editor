/**
 * Headless UI 기반 커스텀 Select 컴포넌트
 *
 * 네이티브 select를 대체하여 일관된 스타일링 제공
 */

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Fragment, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { FOCUS_RING } from '@/constants/styles';

/**
 * 목록 맨 아래 동작 항목이 쓰는 내부 전용 value.
 *
 * 값이 아니라 동작이지만 `ListboxOption`으로 만든다 — 그래야 키보드 이동·클릭 시 닫기를
 * Listbox가 그대로 처리한다. 이 value는 래퍼가 가로채므로 호출부의 값 공간에 새지 않는다.
 */
const FOOTER_ACTION_VALUE = '\u0000select-footer-action';

export interface SelectFooterAction {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
}

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
  /** 목록 맨 아래에 구분선과 함께 붙는 동작 항목 (선택을 바꾸지 않고 `onSelect`만 부른다). */
  footerAction?: SelectFooterAction;
  'data-testid'?: string;
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
  footerAction,
  'data-testid': dataTestId,
}: SelectProps): JSX.Element {
  const handleChange = (next: string): void => {
    if (next === FOOTER_ACTION_VALUE) {
      footerAction?.onSelect();
      return;
    }
    onChange(next);
  };

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

  // 높이 사다리: sm=30(패널 내부 컴팩트) / md=34(표준 인터랙티브 컨트롤)
  const sizeClasses = size === 'sm'
    ? 'h-[30px] text-xs px-2.5'
    : 'h-[34px] text-sm px-3';

  // anchor prop 설정 (Headless UI가 자동으로 Portal과 위치 처리)
  const anchorConfig = anchorPosition === 'top'
    ? { to: 'top start' as const, gap: '4px' }
    : { to: 'bottom start' as const, gap: '4px' };

  return (
    <Listbox value={value} onChange={handleChange} disabled={disabled}>
      <div className={`relative ${className}`}>
        <ListboxButton
          className={`${sizeClasses} w-full rounded-lg border border-editor-border bg-editor-bg text-editor-text
                     flex items-center justify-between gap-2
                     focus:outline-none ${FOCUS_RING}
                     disabled:opacity-50 disabled:cursor-not-allowed
                     hover:bg-editor-surface active:scale-95 transition-colors`}
          aria-label={ariaLabel}
          title={title}
          data-testid={dataTestId}
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
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-editor-muted bg-editor-surface">
                  {group.label}
                </div>
                {group.options.map((option) => (
                  <ListboxOption
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled ?? false}
                    className="group flex items-center gap-2 px-3 py-1.5 text-sm text-editor-text
                               cursor-pointer select-none
                               data-[focus]:bg-primary-100 dark:data-[focus]:bg-primary-900
                               data-[selected]:text-primary-600 dark:data-[selected]:text-primary-400
                               data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                  >
                    <span className="w-3.5 shrink-0">
                      <span className="hidden group-data-[selected]:inline text-primary-500">
                        <Check size={13} />
                      </span>
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
                className="group flex items-center gap-2 px-3 py-1.5 text-sm text-editor-text
                           cursor-pointer select-none
                           data-[focus]:bg-primary-100 dark:data-[focus]:bg-primary-900
                           data-[selected]:text-primary-600 dark:data-[selected]:text-primary-400
                           data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              >
                <span className="w-3.5 shrink-0">
                  <span className="hidden group-data-[selected]:inline text-primary-500">
                    <Check size={13} />
                  </span>
                </span>
                <span className="truncate">{option.label}</span>
              </ListboxOption>
            ))
          )}

          {footerAction && (
            <>
              <div role="separator" className="my-1 h-px bg-editor-border" />
              <ListboxOption
                value={FOOTER_ACTION_VALUE}
                className="group flex items-center gap-2 px-3 py-1.5 text-sm text-editor-muted
                           cursor-pointer select-none
                           data-[focus]:bg-primary-100 dark:data-[focus]:bg-primary-900
                           data-[focus]:text-editor-text"
                data-testid={dataTestId ? `${dataTestId}-footer-action` : undefined}
              >
                <span className="w-3.5 shrink-0">{footerAction.icon}</span>
                <span className="truncate">{footerAction.label}</span>
              </ListboxOption>
            </>
          )}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
