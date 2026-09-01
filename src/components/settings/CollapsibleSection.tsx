/**
 * 앱 설정의 접히는 섹션 헤더.
 *
 * 설정 모달이 세로로 길어져 스크롤 없이는 무엇이 있는지조차 안 보이던 것을 고치기 위한 장치다.
 * 헤더 모양(아이콘 + 제목 + 아래 구분선)은 기존 섹션과 같게 두고 여닫는 기능만 얹는다.
 *
 * `summary`가 접힌 상태에서 이 섹션을 열어볼 이유를 준다 — 접어 두면 상태를 알 수 없어
 * 결국 전부 열어보게 되므로, 접기와 요약은 한 쌍이다.
 *
 * 마크업은 WAI-ARIA 아코디언 패턴을 따른다(`<h3>` 안에 `aria-expanded` 버튼). `<button>`은
 * phrasing content만 담을 수 있어서 `<h3>`를 버튼 안에 넣을 수 없다 — 순서가 반대다.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useUIStore } from '@/stores/uiStore';

interface CollapsibleSectionProps {
  icon?: ReactNode;
  title: string;
  /** 제목 아래 한 줄 설명. 접히면 함께 숨는다. */
  description?: ReactNode;
  /**
   * 헤더 오른쪽에 붙는 조작 요소(관리·가져오기 버튼 등).
   * 토글 버튼 **밖**에 둔다 — `<button>` 안에 `<button>`을 넣을 수 없다.
   */
  action?: ReactNode;
  /**
   * 주면 여닫힘을 uiStore에 영속한다. 사이드바처럼 탭을 옮길 때마다 언마운트되는
   * 자리에서는 이게 없으면 접어둔 것이 매번 다시 열린다.
   * 앱 설정 모달은 "열 때의 상태"로 판정하는 게 맞아 주지 않는다.
   */
  persistId?: string;
  /** 사이드바처럼 촘촘한 자리에서 제목을 설정 패널 공통 크기(text-xs)로 낮춘다. */
  dense?: boolean;
  /** 접힌 상태에서도 보이는 현재 상태 한 줄. */
  summary?: ReactNode;
  /**
   * 열린 채로 시작할지. 마운트 시점에만 읽는다 — 이후로는 사용자의 토글이 이긴다.
   * 설정 모달은 열 때마다 새로 마운트되므로 "열 때의 상태"로 판정된다.
   */
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  icon,
  title,
  description,
  summary,
  action,
  persistId,
  dense = false,
  defaultOpen = false,
  testId,
  children,
}: CollapsibleSectionProps): JSX.Element {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const collapsedIds = useUIStore((s) => s.collapsedSettingsSections);
  const toggleSettingsSection = useUIStore((s) => s.toggleSettingsSection);
  const bodyId = useId();

  // persistId가 있으면 스토어가 진실이다(기본 펼침 — 접은 것만 기록한다).
  const open = persistId ? !(collapsedIds ?? []).includes(persistId) : localOpen;
  const toggle = (): void => {
    if (persistId) toggleSettingsSection(persistId);
    else setLocalOpen((v) => !v);
  };

  return (
    <section>
      {/* 토글과 action은 형제여야 한다 — 버튼 안에 버튼을 넣을 수 없다 */}
      <div className="flex items-start gap-2 border-b border-editor-hairline/50 pb-2">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            data-testid={testId}
            className="group flex w-full items-center gap-2 text-left"
          >
            {icon && <span className="inline-flex shrink-0 text-editor-muted">{icon}</span>}
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-semibold text-editor-text${dense ? ' text-xs' : ''}`}>{title}</span>
              {description && (
                <span className="mt-0.5 block text-[11px] font-normal leading-relaxed text-editor-muted">
                  {description}
                </span>
              )}
            </span>
            {summary && (
              <span className="truncate text-xs text-editor-muted">{summary}</span>
            )}
            <span className="shrink-0 text-editor-muted group-hover:text-editor-text">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
        </h3>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {open && (
        <div id={bodyId} className="space-y-3 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}
