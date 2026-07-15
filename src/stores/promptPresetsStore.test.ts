import { beforeEach, describe, expect, it } from 'vitest';
import {
  migratePromptPresets,
  usePromptPresetsStore,
  selectPresets,
} from './promptPresetsStore';

function reset(): void {
  usePromptPresetsStore.setState({
    rulesPresets: [],
    contextPresets: [],
  });
  localStorage.clear();
}

describe('promptPresetsStore', () => {
  beforeEach(reset);

  it('adds a preset and returns its id', () => {
    const { addPreset } = usePromptPresetsStore.getState();
    const id = addPreset('rules', '게임 번역 규칙', '고유명사는 음차한다');

    expect(id).toBeTruthy();
    const presets = selectPresets(usePromptPresetsStore.getState(), 'rules');
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ id, name: '게임 번역 규칙', content: '고유명사는 음차한다' });
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
    addPreset('rules', 'R', 'rc');
    addPreset('context', 'C', 'cc');

    const s = usePromptPresetsStore.getState();
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
    const id = addPreset('rules', 'old', 'content')!;

    renamePreset('rules', id, 'new');
    expect(selectPresets(usePromptPresetsStore.getState(), 'rules')[0]?.name).toBe('new');

    // 빈 이름은 무시
    renamePreset('rules', id, '   ');
    expect(selectPresets(usePromptPresetsStore.getState(), 'rules')[0]?.name).toBe('new');
  });

  it('overwrites preset content while keeping name and id', () => {
    const { addPreset, updatePresetContent } = usePromptPresetsStore.getState();
    const id = addPreset('rules', 'P', 'old content')!;

    updatePresetContent('rules', id, '  new content  ');
    const [p] = selectPresets(usePromptPresetsStore.getState(), 'rules');
    expect(p?.id).toBe(id);
    expect(p?.name).toBe('P');
    expect(p?.content).toBe('new content');

    // 빈 내용은 무시
    updatePresetContent('rules', id, '   ');
    expect(selectPresets(usePromptPresetsStore.getState(), 'rules')[0]?.content).toBe('new content');
  });

  it('persists to localStorage under ite-prompt-presets', () => {
    usePromptPresetsStore.getState().addPreset('rules', 'R', 'rc');
    const raw = localStorage.getItem('ite-prompt-presets');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('personaPresets');
    expect(raw).toContain('"R"');
  });

  it('migrates unique persona presets into rules presets', () => {
    const migrated = migratePromptPresets({
      rulesPresets: [{ id: 'r1', name: 'Existing', content: 'same content' }],
      contextPresets: [{ id: 'c1', name: 'Context', content: 'context' }],
      personaPresets: [
        { id: 'p1', name: '게임 번역가', content: 'persona rule' },
        { id: 'p2', name: 'Duplicate', content: ' same content ' },
        { id: 'p3', name: 'Legal translator', content: 'legal rule' },
      ],
    }, 1);

    expect(migrated.rulesPresets).toEqual([
      { id: 'r1', name: 'Existing', content: 'same content' },
      { id: 'p1', name: '게임 번역가 (페르소나)', content: 'persona rule' },
      { id: 'p3', name: 'Legal translator (persona)', content: 'legal rule' },
    ]);
    expect(migrated.contextPresets).toEqual([
      { id: 'c1', name: 'Context', content: 'context' },
    ]);
  });
});
