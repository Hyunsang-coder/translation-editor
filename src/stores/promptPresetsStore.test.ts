import { beforeEach, describe, expect, it } from 'vitest';
import { usePromptPresetsStore, selectPresets } from './promptPresetsStore';

function reset(): void {
  usePromptPresetsStore.setState({
    personaPresets: [],
    rulesPresets: [],
    contextPresets: [],
  });
  localStorage.clear();
}

describe('promptPresetsStore', () => {
  beforeEach(reset);

  it('adds a preset and returns its id', () => {
    const { addPreset } = usePromptPresetsStore.getState();
    const id = addPreset('persona', '게임 번역가', '나는 게임 번역가다');

    expect(id).toBeTruthy();
    const presets = selectPresets(usePromptPresetsStore.getState(), 'persona');
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ id, name: '게임 번역가', content: '나는 게임 번역가다' });
  });

  it('trims name and content, rejects empty', () => {
    const { addPreset } = usePromptPresetsStore.getState();

    expect(addPreset('rules', '  ', 'content')).toBeNull();
    expect(addPreset('rules', 'name', '   ')).toBeNull();
    expect(selectPresets(usePromptPresetsStore.getState(), 'rules')).toHaveLength(0);

    addPreset('rules', '  음역 규칙  ', '  - 음역  ');
    const [p] = selectPresets(usePromptPresetsStore.getState(), 'rules');
    expect(p?.name).toBe('음역 규칙');
    expect(p?.content).toBe('- 음역');
  });

  it('keeps each kind independent', () => {
    const { addPreset } = usePromptPresetsStore.getState();
    addPreset('persona', 'P', 'pc');
    addPreset('rules', 'R', 'rc');
    addPreset('context', 'C', 'cc');

    const s = usePromptPresetsStore.getState();
    expect(selectPresets(s, 'persona')).toHaveLength(1);
    expect(selectPresets(s, 'rules')).toHaveLength(1);
    expect(selectPresets(s, 'context')).toHaveLength(1);
  });

  it('deletes a preset by id', () => {
    const { addPreset, deletePreset } = usePromptPresetsStore.getState();
    const id = addPreset('context', 'RPG', 'RPG 게임')!;
    expect(selectPresets(usePromptPresetsStore.getState(), 'context')).toHaveLength(1);

    deletePreset('context', id);
    expect(selectPresets(usePromptPresetsStore.getState(), 'context')).toHaveLength(0);
  });

  it('renames a preset', () => {
    const { addPreset, renamePreset } = usePromptPresetsStore.getState();
    const id = addPreset('persona', 'old', 'content')!;

    renamePreset('persona', id, 'new');
    expect(selectPresets(usePromptPresetsStore.getState(), 'persona')[0]?.name).toBe('new');

    // 빈 이름은 무시
    renamePreset('persona', id, '   ');
    expect(selectPresets(usePromptPresetsStore.getState(), 'persona')[0]?.name).toBe('new');
  });

  it('overwrites preset content while keeping name and id', () => {
    const { addPreset, updatePresetContent } = usePromptPresetsStore.getState();
    const id = addPreset('persona', 'P', 'old content')!;

    updatePresetContent('persona', id, '  new content  ');
    const [p] = selectPresets(usePromptPresetsStore.getState(), 'persona');
    expect(p?.id).toBe(id);
    expect(p?.name).toBe('P');
    expect(p?.content).toBe('new content');

    // 빈 내용은 무시
    updatePresetContent('persona', id, '   ');
    expect(selectPresets(usePromptPresetsStore.getState(), 'persona')[0]?.content).toBe('new content');
  });

  it('persists to localStorage under ite-prompt-presets', () => {
    usePromptPresetsStore.getState().addPreset('persona', 'P', 'pc');
    const raw = localStorage.getItem('ite-prompt-presets');
    expect(raw).toBeTruthy();
    expect(raw).toContain('personaPresets');
    expect(raw).toContain('"P"');
  });
});
