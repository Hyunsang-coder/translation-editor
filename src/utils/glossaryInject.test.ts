import { describe, expect, it, vi } from 'vitest';
import type { GlossaryEntry } from '@/types';
import {
  buildGlossaryQueryWindows,
  formatGlossaryForPrompt,
  mergeGlossaryEntries,
  resolveGlossaryEntries,
  resolveGlossaryForPrompt,
} from './glossaryInject';

function entry(partial: Partial<GlossaryEntry> & Pick<GlossaryEntry, 'id' | 'source' | 'target'>): GlossaryEntry {
  return {
    notes: null,
    domain: null,
    caseSensitive: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('formatGlossaryForPrompt', () => {
  it('formats entries as prompt lines', () => {
    expect(formatGlossaryForPrompt([
      entry({ id: '1', source: 'Care Package', target: '보급 상자' }),
      entry({ id: '2', source: 'Blue Zone', target: '블루존', notes: 'damage zone' }),
    ])).toBe([
      '- Care Package = 보급 상자',
      '- Blue Zone = 블루존 (damage zone)',
    ].join('\n'));
  });

  it('returns empty string for no entries', () => {
    expect(formatGlossaryForPrompt([])).toBe('');
  });
});

describe('buildGlossaryQueryWindows', () => {
  it('returns a single window for short text', () => {
    expect(buildGlossaryQueryWindows('hello world', { windowChars: 100 })).toEqual(['hello world']);
  });

  it('returns empty for blank text', () => {
    expect(buildGlossaryQueryWindows('   ')).toEqual([]);
  });

  it('covers start middle and end of long text', () => {
    const head = 'HEAD_TERM '.repeat(40);
    const mid = 'MID_TERM '.repeat(40);
    const tail = 'TAIL_TERM '.repeat(40);
    const text = `${head}${mid}${tail}`;
    const windows = buildGlossaryQueryWindows(text, { windowChars: 120, maxWindows: 3 });

    expect(windows.length).toBe(3);
    expect(windows[0]).toContain('HEAD_TERM');
    expect(windows[1]).toContain('MID_TERM');
    expect(windows[2]).toContain('TAIL_TERM');
  });
});

describe('mergeGlossaryEntries', () => {
  it('dedupes by normalized source and respects limit / earlier priority', () => {
    const merged = mergeGlossaryEntries([
      [
        entry({ id: 'a', source: 'Care Package', target: '보급 상자' }),
        entry({ id: 'b', source: 'Blue Zone', target: '블루존' }),
      ],
      [
        entry({ id: 'c', source: 'care package', target: '케어패키지' }),
        entry({ id: 'd', source: 'Red Zone', target: '레드존' }),
      ],
    ], 3);

    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'd']);
  });
});

describe('resolveGlossaryForPrompt', () => {
  it('searches multiple windows and formats merged hits', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([entry({ id: '1', source: 'HEAD', target: '머리' })])
      .mockResolvedValueOnce([entry({ id: '2', source: 'TAIL', target: '꼬리' })]);

    const long = `${'HEAD '.repeat(50)}${'TAIL '.repeat(50)}`;
    const result = await resolveGlossaryForPrompt({
      projectId: 'p-1',
      text: long,
      limit: 10,
      windowChars: 80,
      maxWindows: 2,
      search,
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(result).toContain('- HEAD = 머리');
    expect(result).toContain('- TAIL = 꼬리');
  });

  it('returns empty string when search fails', async () => {
    const search = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(resolveGlossaryForPrompt({
      projectId: 'p-1',
      text: 'Care Package',
      search,
    })).resolves.toBe('');
  });

  it('returns empty entries for blank text without calling search', async () => {
    const search = vi.fn();
    await expect(resolveGlossaryEntries({
      projectId: 'p-1',
      text: '   ',
      search,
    })).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
