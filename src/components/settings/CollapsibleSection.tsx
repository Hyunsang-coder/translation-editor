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

interface CollapsibleSectionProps {
  icon: ReactNode;
  title: string;
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
  summary,
  defaultOpen = false,
  testId,
  children,
}: CollapsibleSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section>
      <h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid={testId}
          className="group flex w-full items-center gap-2 border-b border-editor-border/50 pb-2 text-left"
        >
          <span className="inline-flex text-editor-muted">{icon}</span>
          <span className="font-semibold text-editor-text">{title}</span>
          {summary && (
            <span className="truncate text-xs text-editor-muted">{summary}</span>
          )}
          <span className="ml-auto shrink-0 text-editor-muted group-hover:text-editor-text">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="space-y-3 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}
