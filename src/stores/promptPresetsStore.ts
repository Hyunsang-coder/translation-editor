import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Prompt Preset Library (전역)
 *
 * 페르소나 / 번역 규칙 / 프로젝트 컨텍스트를 각각 이름 붙여 여러 개 저장해두고
 * 어느 프로젝트에서든 목록에서 골라 입력란에 적용(수동)할 수 있게 한다.
 *
 * - 저장소: localStorage (zustand persist), 전역 공유 (프로젝트 무관)
 * - 시스템 프롬프트/도구 지침은 건드리지 않음. 적용 시 기존 setter를 호출할 뿐.
 */

export type PromptPresetKind = 'persona' | 'rules' | 'context';

export interface PromptPreset {
  id: string;
  name: string;
  content: string;
}

interface PromptPresetsState {
  personaPresets: PromptPreset[];
  rulesPresets: PromptPreset[];
  contextPresets: PromptPreset[];
  /** 현재 값을 이름 붙여 프리셋으로 추가. 생성된 프리셋의 id 반환(빈 content면 미저장 후 null). */
  addPreset: (kind: PromptPresetKind, name: string, content: string) => string | null;
  /** 프리셋 삭제 */
  deletePreset: (kind: PromptPresetKind, id: string) => void;
  /** 프리셋 이름 변경 */
  renamePreset: (kind: PromptPresetKind, id: string, name: string) => void;
  /** 기존 프리셋 내용 덮어쓰기 (이름 유지) */
  updatePresetContent: (kind: PromptPresetKind, id: string, content: string) => void;
}

const FIELD_BY_KIND: Record<PromptPresetKind, keyof Pick<
  PromptPresetsState,
  'personaPresets' | 'rulesPresets' | 'contextPresets'
>> = {
  persona: 'personaPresets',
  rules: 'rulesPresets',
  context: 'contextPresets',
};

function generateId(): string {
  // crypto.randomUUID는 ghostMask 등 앱 전반에서 사용 중 (브라우저/Tauri 모두 지원)
  return crypto.randomUUID();
}

export const usePromptPresetsStore = create<PromptPresetsState>()(
  persist(
    (set) => ({
      personaPresets: [],
      rulesPresets: [],
      contextPresets: [],

      addPreset: (kind, name, content) => {
        const trimmedContent = content.trim();
        const trimmedName = name.trim();
        if (!trimmedContent || !trimmedName) return null;

        const field = FIELD_BY_KIND[kind];
        const preset: PromptPreset = {
          id: generateId(),
          name: trimmedName,
          content: trimmedContent,
        };
        set((state) => ({ [field]: [...state[field], preset] }) as Partial<PromptPresetsState>);
        return preset.id;
      },

      deletePreset: (kind, id) => {
        const field = FIELD_BY_KIND[kind];
        set((state) => ({
          [field]: state[field].filter((p) => p.id !== id),
        }) as Partial<PromptPresetsState>);
      },

      renamePreset: (kind, id, name) => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        const field = FIELD_BY_KIND[kind];
        set((state) => ({
          [field]: state[field].map((p) => (p.id === id ? { ...p, name: trimmedName } : p)),
        }) as Partial<PromptPresetsState>);
      },

      updatePresetContent: (kind, id, content) => {
        const trimmedContent = content.trim();
        if (!trimmedContent) return;
        const field = FIELD_BY_KIND[kind];
        set((state) => ({
          [field]: state[field].map((p) => (p.id === id ? { ...p, content: trimmedContent } : p)),
        }) as Partial<PromptPresetsState>);
      },
    }),
    {
      name: 'ite-prompt-presets',
      version: 1,
      partialize: (state) => ({
        personaPresets: state.personaPresets,
        rulesPresets: state.rulesPresets,
        contextPresets: state.contextPresets,
      }),
    }
  )
);

/** kind에 해당하는 프리셋 목록을 반환하는 셀렉터 헬퍼 */
export function selectPresets(
  state: PromptPresetsState,
  kind: PromptPresetKind,
): PromptPreset[] {
  return state[FIELD_BY_KIND[kind]];
}
