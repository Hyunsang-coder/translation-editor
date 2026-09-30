import { describe, expect, it, vi } from 'vitest';
import type { GlossaryEntry } from '@/types';
import {
  buildGlossaryQueryWindows,
  formatGlossaryForPrompt,
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

/** 서로 겹치지 않는 고유 토큰(`T00001 `)으로 채운 텍스트. 윈도우 커버리지 검증용. */
function numberedTokens(length: number): string {
  let text = '';
  for (let i = 0; text.length < length; i += 1) text += `T${String(i).padStart(5, '0')} `;
  return text.slice(0, length).trim();
}

/** 어떤 윈도우에도 통째로 들어있지 않은 토큰 목록. 빈 배열이면 빈틈 없이 덮인 것. */
function uncoveredTokens(text: string, windows: string[]): string[] {
  return text
    .split(' ')
    .filter((token) => /^T\d{5}$/.test(token))
    .filter((token) => !windows.some((window) => window.includes(token)));
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

  it('marks case-sensitive entries and leaves insensitive entries unmarked', () => {
    expect(formatGlossaryForPrompt([
      entry({ id: '1', source: 'Apple', target: '사과' }),
      entry({ id: '2', source: 'Bolt', target: '볼트', caseSensitive: true }),
      entry({ id: '3', source: 'Nut', target: '너트', notes: '부품', caseSensitive: true }),
    ])).toBe([
      '- Apple = 사과',
      '- Bolt = 볼트 (대소문자 구분, case-sensitive)',
      '- Nut = 너트 (부품) (대소문자 구분, case-sensitive)',
    ].join('\n'));
  });
});

describe('buildGlossaryQueryWindows', () => {
  it('returns a single window for short text', () => {
    expect(buildGlossaryQueryWindows('hello world', { windowChars: 100 })).toEqual(['hello world']);
  });

  it('returns empty for blank text', () => {
    expect(buildGlossaryQueryWindows('   ')).toEqual([]);
  });

  it('covers the whole text without gaps, however long it is', () => {
    const text = numberedTokens(20_000);
    const windows = buildGlossaryQueryWindows(text);

    expect(windows.length).toBeGreaterThan(4);
    expect(uncoveredTokens(text, windows)).toEqual([]);
  });

  it('keeps every window within windowChars', () => {
    const windows = buildGlossaryQueryWindows(numberedTokens(5_000), { windowChars: 120, overlapChars: 20 });

    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(window.length).toBeLessThanOrEqual(120);
    }
  });

  it('overlaps neighbouring windows so a term on a boundary stays whole in one window', () => {
    // 토큰 길이(6)보다 겹침(20)이 크므로, 어느 경계에 걸려도 토큰 하나는 통째로 한 윈도우에 들어가야 한다.
    const text = numberedTokens(3_000);
    const windows = buildGlossaryQueryWindows(text, { windowChars: 120, overlapChars: 20 });

    expect(uncoveredTokens(text, windows)).toEqual([]);
  });

  it('still terminates and covers the text when overlap is not smaller than the window', () => {
    const text = numberedTokens(600);
    const windows = buildGlossaryQueryWindows(text, { windowChars: 50, overlapChars: 500 });

    expect(windows.length).toBeGreaterThan(1);
    expect(uncoveredTokens(text, windows)).toEqual([]);
  });
});

describe('resolveGlossaryForPrompt', () => {
  it('sends all windows to a single search call and formats its hits', async () => {
    const search = vi.fn().mockResolvedValue([
      entry({ id: '1', source: 'HEAD', target: '머리' }),
      entry({ id: '2', source: 'TAIL', target: '꼬리' }),
    ]);

    const long = `${'HEAD '.repeat(50)}${'TAIL '.repeat(50)}`;
    const result = await resolveGlossaryForPrompt({
      projectId: 'p-1',
      text: long,
      domain: 'game',
      limit: 10,
      windowChars: 80,
      search,
    });

    expect(search).toHaveBeenCalledTimes(1);
    const args = search.mock.calls[0]?.[0];
    expect(args.projectId).toBe('p-1');
    expect(args.domain).toBe('game');
    expect(args.limit).toBe(10);
    expect(args.queries.length).toBeGreaterThan(1);
    expect(args.queries.join('')).toContain('HEAD');
    expect(args.queries.join('')).toContain('TAIL');
    expect(result).toContain('- HEAD = 머리');
    expect(result).toContain('- TAIL = 꼬리');
  });

  it('does not truncate a long document to a few windows', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const text = numberedTokens(50_000);

    await resolveGlossaryEntries({ projectId: 'p-1', text, search });

    expect(search).toHaveBeenCalledTimes(1);
    expect(uncoveredTokens(text, search.mock.calls[0]?.[0].queries)).toEqual([]);
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
