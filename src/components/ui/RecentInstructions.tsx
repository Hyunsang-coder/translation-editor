import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  selectRecentInstructions,
  useInstructionHistoryStore,
  type InstructionKind,
} from '@/stores/instructionHistoryStore';

interface RecentInstructionsProps {
  projectId: string | undefined;
  kind: InstructionKind;
  /** 현재 입력칸 값. 덧붙일지 채울지, 이미 들어간 항목인지 판정에 쓴다. */
  value: string;
  onPick: (next: string) => void;
  disabled?: boolean;
}

/** 입력칸에 그 지시문이 한 줄로 들어가 있는지 */
function containsLine(value: string, instruction: string): boolean {
  return value.split('\n').some((line) => line.trim() === instruction);
}

/**
 * "추가 지시사항" 입력칸 아래에 붙는 최근 입력 칩.
 *
 * 기록이 없으면 아무것도 그리지 않는다 — 처음 쓰는 프로젝트에서 빈 줄이 남지 않게.
 */
export function RecentInstructions({
  projectId,
  kind,
  value,
  onPick,
  disabled = false,
}: RecentInstructionsProps): JSX.Element | null {
  const { t } = useTranslation();
  const recent = useInstructionHistoryStore((state) =>
    selectRecentInstructions(state, projectId, kind),
  );
  const removeInstruction = useInstructionHistoryStore((state) => state.removeInstruction);

  if (recent.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="recent-instructions">
      <span className="text-[10px] font-medium uppercase tracking-wide text-editor-muted">
        {t('common.recentInstructions', '최근')}
      </span>
      {recent.map((instruction) => {
        const alreadyIn = containsLine(value, instruction);
        return (
          // 칩 안에 버튼이 둘이라 바깥은 span이다 — button 안의 button은 유효하지 않다.
          <span
            key={instruction}
            className={`group inline-flex max-w-[13rem] items-center rounded-full border text-[11px] transition-colors ${
              alreadyIn
                ? 'border-primary-300 bg-primary-500/10 text-editor-muted'
                : 'border-editor-border text-editor-text'
            }`}
          >
            <button
              type="button"
              data-testid="recent-instruction-chip"
              title={instruction}
              disabled={disabled || alreadyIn}
              // 이미 들어간 문장은 눌러도 할 일이 없다. 조용히 무시하는 대신 눌리지 않게 한다.
              aria-label={t('common.recentInstructionApply', {
                text: instruction,
                defaultValue: '지시사항 넣기: {{text}}',
              })}
              onClick={() =>
                // 비어 있으면 채우고, 쓰던 내용이 있으면 줄바꿈으로 덧붙인다. 덮어쓰면
                // 타이핑하던 것이 날아가는데 controlled textarea라 되돌릴 수 없다.
                onPick(value.trim() ? `${value.trimEnd()}\n${instruction}` : instruction)
              }
              className={`min-w-0 truncate rounded-l-full py-0.5 pl-2 pr-1 transition-colors ${
                alreadyIn ? 'cursor-default' : 'hover:bg-editor-border/50 disabled:opacity-50'
              }`}
            >
              {instruction}
            </button>
            <button
              type="button"
              data-testid="recent-instruction-remove"
              disabled={disabled}
              aria-label={t('common.recentInstructionRemove', {
                text: instruction,
                defaultValue: '최근 지시사항에서 지우기: {{text}}',
              })}
              onClick={() => removeInstruction(projectId, kind, instruction)}
              // 평소엔 투명하지만 자리는 차지한다 — hover마다 칩 폭이 바뀌면 줄이 출렁인다.
              className="shrink-0 rounded-r-full py-0.5 pl-0.5 pr-1.5 text-editor-muted opacity-0 transition-opacity hover:text-editor-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        );
      })}
    </div>
  );
}
