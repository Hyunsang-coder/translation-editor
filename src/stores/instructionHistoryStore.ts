import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * "추가 지시사항" 최근 입력 기록 (프로젝트별 · 용도별)
 *
 * - 저장소: localStorage (zustand persist) — `promptPresetsStore`와 같은 패턴.
 * - **프로젝트별**로 나눈다. 지시사항은 그 프로젝트의 스타일·용어 결정이라 다른
 *   프로젝트로 넘기지 않는다(`EditorCanvasTipTap`이 프로젝트 전환 시 입력값을 비우는
 *   것과 같은 이유).
 * - **용도별**로도 나눈다. 검수 지시문("용어 일관성 위주로")과 폴리싱 지시문("더
 *   격식체로")은 성격이 달라 한 통에 담으면 서로 방해가 된다.
 * - 기록 시점은 **실제로 실행할 때**다. 입력만 하고 취소한 문장은 남지 않는다.
 */
export type InstructionKind =
  | 'selectionRetranslate'
  | 'selectionPolish'
  | 'documentRetranslate'
  | 'documentPolish'
  | 'review'
  | 'issueRetranslate';

/** 용도마다 보관하는 최대 개수. 칩 한 줄에 들어가는 양이 기준. */
export const MAX_RECENT_INSTRUCTIONS = 5;

type HistoryByKind = Partial<Record<InstructionKind, string[]>>;

interface InstructionHistoryState {
  /** projectId → 용도 → 최근 지시문 (최신이 앞) */
  byProject: Record<string, HistoryByKind>;
  /** 실행한 지시문을 기록한다. 빈 문자열·프로젝트 미지정은 무시. */
  recordInstruction: (
    projectId: string | undefined,
    kind: InstructionKind,
    instruction: string,
  ) => void;
  /** 프로젝트를 지울 때 함께 정리 (localStorage에 유령 항목이 남지 않게). */
  forgetProject: (projectId: string) => void;
}

export const useInstructionHistoryStore = create<InstructionHistoryState>()(
  persist(
    (set) => ({
      byProject: {},

      recordInstruction: (projectId, kind, instruction) => {
        const trimmed = instruction.trim();
        if (!projectId || !trimmed) return;
        set((state) => {
          const forProject = state.byProject[projectId] ?? {};
          // 같은 문장을 다시 쓰면 새 항목이 아니라 맨 앞으로 올라온다.
          const next = [
            trimmed,
            ...(forProject[kind] ?? []).filter((item) => item !== trimmed),
          ].slice(0, MAX_RECENT_INSTRUCTIONS);
          return {
            byProject: {
              ...state.byProject,
              [projectId]: { ...forProject, [kind]: next },
            },
          };
        });
      },

      forgetProject: (projectId) => {
        set((state) => {
          if (!(projectId in state.byProject)) return state;
          const next = { ...state.byProject };
          delete next[projectId];
          return { byProject: next };
        });
      },
    }),
    {
      name: 'ite-instruction-history',
      version: 1,
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);

/** 해당 프로젝트·용도의 최근 지시문. 없으면 빈 배열(참조가 고정되어 리렌더를 안 만든다). */
const EMPTY: readonly string[] = [];

export function selectRecentInstructions(
  state: InstructionHistoryState,
  projectId: string | undefined,
  kind: InstructionKind,
): readonly string[] {
  if (!projectId) return EMPTY;
  return state.byProject[projectId]?.[kind] ?? EMPTY;
}
