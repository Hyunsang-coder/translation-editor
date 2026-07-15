import { searchGlossary } from '@/tauri/glossary';
import type { GlossaryEntry, ProjectDomain } from '@/types';

export const DEFAULT_GLOSSARY_WINDOW_CHARS = 3000;
export const DEFAULT_GLOSSARY_MAX_WINDOWS = 4;

export function formatGlossaryForPrompt(
  entries: Array<Pick<GlossaryEntry, 'source' | 'target' | 'notes'>>,
): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry) => (
      `- ${entry.source} = ${entry.target}${entry.notes ? ` (${entry.notes})` : ''}`
    ))
    .join('\n');
}

/**
 * 긴 문서에서도 앞/중간/뒤를 고르게 커버하도록 검색 쿼리 윈도우를 만든다.
 * 검색은 `instr(query, source)`라서 문서 앞부분만 자르면 후반 용어가 누락된다.
 */
export function buildGlossaryQueryWindows(
  text: string,
  options?: {
    windowChars?: number;
    maxWindows?: number;
  },
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const windowChars = Math.max(1, options?.windowChars ?? DEFAULT_GLOSSARY_WINDOW_CHARS);
  const maxWindows = Math.max(1, options?.maxWindows ?? DEFAULT_GLOSSARY_MAX_WINDOWS);

  if (trimmed.length <= windowChars) {
    return [trimmed];
  }

  const windows: string[] = [];
  const lastStart = trimmed.length - windowChars;
  const step = maxWindows === 1
    ? lastStart
    : Math.max(1, Math.floor(lastStart / (maxWindows - 1)));

  for (let i = 0; i < maxWindows; i += 1) {
    const start = Math.min(i * step, lastStart);
    const slice = trimmed.slice(start, start + windowChars);
    if (windows[windows.length - 1] !== slice) {
      windows.push(slice);
    }
    if (start >= lastStart) break;
  }

  return windows;
}

export function mergeGlossaryEntries(
  lists: GlossaryEntry[][],
  limit: number,
): GlossaryEntry[] {
  const cappedLimit = Math.max(0, limit);
  if (cappedLimit === 0) return [];

  const seen = new Set<string>();
  const merged: GlossaryEntry[] = [];

  for (const list of lists) {
    for (const entry of list) {
      const key = entry.source.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
      if (merged.length >= cappedLimit) return merged;
    }
  }

  return merged;
}

export interface ResolveGlossaryForPromptParams {
  projectId: string;
  text: string;
  domain?: ProjectDomain | string | null;
  limit?: number;
  windowChars?: number;
  maxWindows?: number;
  /** 테스트용 주입. 기본은 tauri searchGlossary. */
  search?: typeof searchGlossary;
}

/**
 * 문서 텍스트에서 관련 용어 엔트리를 검색한다.
 * 검색 실패 시 빈 배열 (호출부가 파이프라인을 계속 진행하도록).
 */
export async function resolveGlossaryEntries(
  params: ResolveGlossaryForPromptParams,
): Promise<GlossaryEntry[]> {
  const {
    projectId,
    text,
    domain,
    limit = 30,
    windowChars,
    maxWindows,
    search = searchGlossary,
  } = params;

  const windows = buildGlossaryQueryWindows(text, {
    ...(windowChars === undefined ? {} : { windowChars }),
    ...(maxWindows === undefined ? {} : { maxWindows }),
  });
  if (windows.length === 0 || limit <= 0) return [];

  try {
    const hitLists = await Promise.all(
      windows.map((query) => search({
        projectId,
        query,
        ...(domain == null ? {} : { domain }),
        limit,
      })),
    );
    return mergeGlossaryEntries(hitLists, limit);
  } catch {
    return [];
  }
}

/**
 * 문서 텍스트에서 관련 용어를 검색해 프롬프트용 문자열로 반환.
 * 검색 실패 시 빈 문자열 (호출부가 파이프라인을 계속 진행하도록).
 */
export async function resolveGlossaryForPrompt(
  params: ResolveGlossaryForPromptParams,
): Promise<string> {
  return formatGlossaryForPrompt(await resolveGlossaryEntries(params));
}
