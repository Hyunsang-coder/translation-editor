import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Prompt Preset Library (전역)
 *
 * 번역 규칙 / 프로젝트 컨텍스트를 각각 이름 붙여 여러 개 저장해두고
 * 어느 프로젝트에서든 목록에서 골라 입력란에 적용(수동)할 수 있게 한다.
 *
 * - 저장소: localStorage (zustand persist), 전역 공유 (프로젝트 무관)
 * - 시스템 프롬프트/도구 지침은 건드리지 않음. 적용 시 기존 setter를 호출할 뿐.
 */

export type PromptPresetKind = 'rules' | 'context';

export interface PromptPreset {
  id: string;
  name: string;
  content: string;
}

interface PromptPresetsState {
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
  'rulesPresets' | 'contextPresets'
>> = {
  rules: 'rulesPresets',
  context: 'contextPresets',
};

interface PersistedPromptPresetsV1 {
  personaPresets?: PromptPreset[];
  rulesPresets?: PromptPreset[];
  contextPresets?: PromptPreset[];
}

export function migratePromptPresets(
  persistedState: unknown,
  version: number,
): Pick<PromptPresetsState, 'rulesPresets' | 'contextPresets'> {
  const oldState = (persistedState ?? {}) as PersistedPromptPresetsV1;
  const rulesPresets = Array.isArray(oldState.rulesPresets) ? [...oldState.rulesPresets] : [];
  const contextPresets = Array.isArray(oldState.contextPresets) ? oldState.contextPresets : [];

  if (version < 2 && Array.isArray(oldState.personaPresets)) {
    const existingContents = new Set(rulesPresets.map((preset) => preset.content.trim()));
    for (const preset of oldState.personaPresets) {
      const content = preset.content.trim();
      if (!content || existingContents.has(content)) continue;
      const suffix = /[가-힣]/.test(preset.name) ? ' (페르소나)' : ' (persona)';
      rulesPresets.push({ ...preset, name: `${preset.name}${suffix}`, content });
      existingContents.add(content);
    }
  }

  return { rulesPresets, contextPresets };
}

function generateId(): string {
  // crypto.randomUUID는 secure context에서만 보장됨. 일부 WebView/비보안 컨텍스트에서
  // undefined이거나 예외를 던질 수 있어 fallback을 둔다.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const usePromptPresetsStore = create<PromptPresetsState>()(
  persist(
    (set) => ({
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
      version: 2,
      migrate: migratePromptPresets,
      partialize: (state) => ({
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
