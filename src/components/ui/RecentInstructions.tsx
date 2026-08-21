import { useTranslation } from 'react-i18next';
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

  if (recent.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="recent-instructions">
      <span className="text-[10px] font-medium uppercase tracking-wide text-editor-muted">
        {t('common.recentInstructions', '최근')}
      </span>
      {recent.map((instruction) => {
        const alreadyIn = containsLine(value, instruction);
        return (
          <button
            key={instruction}
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
            className={`max-w-[12rem] truncate rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              alreadyIn
                ? 'cursor-default border-primary-300 bg-primary-500/10 text-editor-muted'
                : 'border-editor-border text-editor-text hover:bg-editor-border/50 disabled:opacity-50'
            }`}
          >
            {instruction}
          </button>
        );
      })}
    </div>
  );
}
