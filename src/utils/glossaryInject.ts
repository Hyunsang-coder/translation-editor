import { searchGlossary } from '@/tauri/glossary';
import type { GlossaryEntry, ProjectDomain } from '@/types';

export const DEFAULT_GLOSSARY_WINDOW_CHARS = 3000;
/** 윈도우 경계에 걸친 용어를 놓치지 않도록 이웃 윈도우끼리 겹치는 글자 수. 가장 긴 용어보다 커야 한다. */
export const DEFAULT_GLOSSARY_OVERLAP_CHARS = 200;

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
 * 문서 전체를 빈틈없이 덮는 검색 쿼리 윈도우를 만든다.
 * 검색은 `instr(query, source)`라서 문서 일부만 잘라 보내면 나머지 구간의 용어가 누락된다.
 * 이웃 윈도우는 `overlapChars`만큼 겹쳐, 경계에 걸친 용어도 한 윈도우에 통째로 들어간다.
 */
export function buildGlossaryQueryWindows(
  text: string,
  options?: {
    windowChars?: number;
    overlapChars?: number;
  },
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const windowChars = Math.max(1, options?.windowChars ?? DEFAULT_GLOSSARY_WINDOW_CHARS);
  if (trimmed.length <= windowChars) {
    return [trimmed];
  }

  // 겹침이 윈도우의 절반을 넘으면 전진 폭이 너무 작아지므로 절반으로 제한한다.
  const overlapChars = Math.min(
    Math.max(0, options?.overlapChars ?? DEFAULT_GLOSSARY_OVERLAP_CHARS),
    Math.floor(windowChars / 2),
  );
  const step = windowChars - overlapChars;

  const windows: string[] = [];
  for (let start = 0; ; start += step) {
    windows.push(trimmed.slice(start, start + windowChars));
    if (start + windowChars >= trimmed.length) break;
  }
  return windows;
}

export interface ResolveGlossaryForPromptParams {
  projectId: string;
  text: string;
  domain?: ProjectDomain | string | null;
  limit?: number;
  windowChars?: number;
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
    limit = 100,
    windowChars,
    search = searchGlossary,
  } = params;

  const windows = buildGlossaryQueryWindows(text, {
    ...(windowChars === undefined ? {} : { windowChars }),
  });
  if (windows.length === 0 || limit <= 0) return [];

  // 윈도우 병합·중복 제거·limit은 백엔드가 전역 순서로 처리한다 (IPC 한 번).
  try {
    return await search({
      projectId,
      queries: windows,
      ...(domain == null ? {} : { domain }),
      limit,
    });
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
