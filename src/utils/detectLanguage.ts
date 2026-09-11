/**
 * 번역 방향(원문 언어 → 타겟 언어) 해석.
 *
 * 원문·타겟 모두 프로젝트에 저장되고(`metadata.sourceLanguage`/`targetLanguage`),
 * 센티널 `'auto'`면 쓰는 시점에 원문 텍스트에서 푼다. 결정 근거는 ADR-0020·ADR-0021.
 */
import { stripHtml } from './hash';

/**
 * 표 헤더용 언어 코드. 저장값(한글 표기)과 외부에서 오는 영문명을 모두 받는다.
 * 모르는 언어면 null — 코드 없이 표시한다.
 */
const LANGUAGE_CODES: Record<string, string> = {
  Korean: 'KO',
  한국어: 'KO',
  English: 'EN',
  영어: 'EN',
  Japanese: 'JA',
  일본어: 'JA',
  Chinese: 'ZH',
  중국어: 'ZH',
  Spanish: 'ES',
  스페인어: 'ES',
  Russian: 'RU',
  러시아어: 'RU',
};

export function languageShortCode(language: string | null | undefined): string | null {
  if (!language) return null;
  return LANGUAGE_CODES[language.trim()] ?? null;
}

/**
 * 언어 이름을 비교 가능한 코드로 정규화한다. 저장값은 한글 라벨('한국어'),
 * 외부(검수 응답·브리지)에서는 영문명('Korean')이 들어올 수 있다 —
 * **문자열끼리 비교하면 영원히 안 맞으므로** 방향 판정은 반드시 이 함수를 거친다.
 */
export function normalizeLang(language: string | null | undefined): string | null {
  return languageShortCode(language)?.toLowerCase() ?? null;
}

/** 두 언어명이 같은 언어를 가리키는가. 한쪽이라도 모르는 언어면 false(가드를 걸지 않는다). */
export function isSameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeLang(a);
  return na !== null && na === normalizeLang(b);
}

/** 원문·타겟 Select의 '자동' 항목 값. 프로젝트에는 이 센티널이 그대로 저장된다. */
export const AUTO_LANGUAGE = 'auto';

/** Select의 명시 선택지. 저장값은 언제나 이 한글 라벨이다. */
export const LANGUAGE_VALUES = ['한국어', '영어', '일본어', '중국어', '스페인어', '러시아어'] as const;

/** 문자 체계로 가를 수 있는 언어. 스페인어·러시아어는 자동 판정 대상이 아니다(명시 선택 전용). */
export type LangCode = 'ko' | 'en' | 'ja' | 'zh';

const LABEL_BY_CODE: Record<LangCode, string> = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  zh: '중국어',
};

/**
 * 자동 언어 감지의 최대 입력 크기. 긴 문서는 앞·중간·끝을 고르게 뽑으므로 첫 코드 블록이나
 * 영문 제목에 끌리지 않으며, 모든 호출의 작업량도 이 상한으로 고정된다.
 */
export const LANGUAGE_DETECTION_MAX_CHARS = 12_000;
const LANGUAGE_SAMPLE_PARTS = 3;
const KOREAN_MIN_CHARS = 12;
const KOREAN_MIN_RATIO = 0.08;
const ENGLISH_MIN_CHARS = 20;
const ENGLISH_MIN_RATIO = 0.6;

interface LanguageCounts {
  korean: number;
  japanese: number;
  chinese: number;
  latin: number;
  total: number;
}

/** 긴 문서도 고정 예산 안에서 앞·중간·끝의 본문 신호를 모두 반영한다. */
function takeBalancedSample(text: string): string {
  if (text.length <= LANGUAGE_DETECTION_MAX_CHARS) return text;

  const partLength = Math.floor(LANGUAGE_DETECTION_MAX_CHARS / LANGUAGE_SAMPLE_PARTS);
  const middleStart = Math.max(0, Math.floor((text.length - partLength) / 2));
  const endStart = Math.max(0, text.length - partLength);
  return [
    text.slice(0, partLength),
    text.slice(middleStart, middleStart + partLength),
    text.slice(endStart),
  ].join('\n');
}

/** 셸 명령·소스 코드처럼 라틴 문자가 많지만 자연어가 아닌 줄은 언어 신호에서 제외한다. */
function isCodeLikeLine(line: string): boolean {
  const compact = line.replace(/\s/g, '');
  if (compact.length < 12) return false;
  const syntax = (compact.match(/[\\{}[\]();=|$<>`]/g) || []).length;
  return syntax >= 2 && syntax / compact.length >= 0.04;
}

/**
 * 자동 감지에만 쓸 정규화 표본. URL·코드·HTML 서식은 자연어의 언어 신호가 아니므로 제외한다.
 * 입력을 먼저 고정 예산으로 자른 뒤 처리해 대형 문서에서도 UI 작업을 막지 않는다.
 */
export function languageDetectionSample(text: string | null | undefined): string {
  const sampled = takeBalancedSample(String(text ?? ''));
  return stripHtml(sampled)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>)\]]+/gi, ' ')
    .split(/\r?\n/)
    .filter((line) => !isCodeLikeLine(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** HTML 원문을 쓰는 호출부도 동일한 감지 표본을 사용한다. */
export function sourceSampleFromHtml(html: string | null | undefined): string {
  return languageDetectionSample(html);
}

function countLanguageSignals(sample: string): LanguageCounts {
  const korean = (sample.match(/[가-힯ᄀ-ᇿ]/g) || []).length;
  const japanese = (sample.match(/[぀-ゟ゠-ヿ]/g) || []).length;
  const chinese = (sample.match(/[一-鿿]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;
  return { korean, japanese, chinese, latin, total: korean + japanese + chinese + latin };
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

/** 자동 방향 결정 전용 원문 판정 — 신뢰도가 낮으면 null로 두고 수동 선택을 요구한다. */
function detectSourceFromCounts(counts: LanguageCounts): 'ko' | 'en' | null {
  if (counts.total === 0) return null;

  if (ratio(counts.japanese, counts.total) >= 0.05) return null;
  if (ratio(counts.chinese, counts.total) >= 0.1) return null;
  if (counts.korean >= KOREAN_MIN_CHARS && ratio(counts.korean, counts.total) >= KOREAN_MIN_RATIO) return 'ko';
  if (counts.latin >= ENGLISH_MIN_CHARS && ratio(counts.latin, counts.total) >= ENGLISH_MIN_RATIO) return 'en';
  return null;
}

export function detectSourceLangCode(text: string): 'ko' | 'en' | null {
  return detectSourceFromCounts(countLanguageSignals(languageDetectionSample(text)));
}

/** 자동 라벨의 보조 판정. 일본어·중국어는 라벨만 표시하고 자동 타겟은 정하지 않는다. */
function detectDominantFromCounts(counts: LanguageCounts): LangCode | null {
  if (counts.total === 0) return null;
  if (ratio(counts.korean, counts.total) > 0.3) return 'ko';
  if (ratio(counts.japanese, counts.total) > 0.3) return 'ja';
  if (ratio(counts.chinese, counts.total) > 0.3) return 'zh';
  if (ratio(counts.latin, counts.total) >= ENGLISH_MIN_RATIO) return 'en';
  return null;
}

export function detectDominantLangCode(text: string): LangCode | null {
  return detectDominantFromCounts(countLanguageSignals(languageDetectionSample(text)));
}

/** 자동일 때 표시·프롬프트에 쓸 원문 언어. 하나의 표본을 공유해 재계산을 피한다. */
function detectSourceLabel(text: string): string | null {
  const counts = countLanguageSignals(languageDetectionSample(text));
  const code = detectSourceFromCounts(counts) ?? detectDominantFromCounts(counts);
  return code ? LABEL_BY_CODE[code] : null;
}

export interface ResolvedLanguage {
  /** 프롬프트·표시에 쓸 언어명. 자동인데 판정 실패면 null. */
  language: string | null;
  /** 감지로 푼 값이면 true (UI에 "자동 (영어)"로 밝히고, 저장값은 여전히 'auto') */
  auto: boolean;
}

export interface ResolvedDirection {
  source: ResolvedLanguage;
  target: ResolvedLanguage;
}

/**
 * 저장된 언어 설정 두 개.
 *
 * `ProjectMetadata`를 통째로 받지 않는다 — 호출부가 스칼라 두 개만 스토어에서 고를 수 있어야
 * `metadata` 객체 정체성이 바뀔 때마다(저장 시 `updatedAt` 갱신) 리렌더가 번지지 않는다.
 */
export interface DirectionSettings {
  source?: string | null | undefined;
  target?: string | null | undefined;
}

/**
 * 자동 타겟은 원문의 반대 언어. **일본어·중국어·그 밖은 뒤집지 않는다** — ja→ko인지 ja→en인지
 * 근거가 없어서, 자동으로 고르면 조용히 틀린 방향으로 간다(호출부가 명시 선택을 요구한다).
 */
function oppositeLanguage(sourceLanguage: string | null): string | null {
  const code = normalizeLang(sourceLanguage);
  if (code === 'ko') return '영어';
  if (code === 'en') return '한국어';
  return null;
}

function resolveStored(stored: string | null | undefined, fallback: () => string | null): ResolvedLanguage {
  const trimmed = stored?.trim();
  if (trimmed && trimmed !== AUTO_LANGUAGE) {
    return { language: trimmed, auto: false };
  }
  return { language: fallback(), auto: true };
}

/**
 * 원문·타겟 언어를 한 번에 해석한다.
 *
 * **저장값을 프롬프트·MCP·UI로 흘리는 모든 경로는 이 함수를 거쳐야 한다** — 안 거치면
 * 센티널 문자열 `'auto'`가 그대로 프롬프트에 박힌다.
 *
 * 원문이 명시 선택이면 자동 타겟은 **텍스트를 다시 감지하지 않고 그 값을 뒤집는다**.
 * 원문·타겟을 따로 푸는 API였다면 호출부 하나만 빠뜨려도 여기가 조용히 어긋난다(ADR-0021).
 */
export function resolveDirection(
  stored: DirectionSettings | null | undefined,
  sourceText: string,
): ResolvedDirection {
  const source = resolveStored(stored?.source, () => detectSourceLabel(sourceText));
  const target = resolveStored(stored?.target, () => oppositeLanguage(source.language));
  return { source, target };
}

/** 드롭다운의 '자동' 항목 라벨용 — 저장값이 명시 선택이어도 "자동이면 무엇이 될지"를 보여준다. */
export function resolveAutoDirection(sourceText: string): ResolvedDirection {
  return resolveDirection({ source: AUTO_LANGUAGE, target: AUTO_LANGUAGE }, sourceText);
}

/** 번역을 막아야 하는 이유. 호출부가 그대로 토스트 키로 쓴다. */
export type DirectionIssue = 'target-undecided';

/**
 * 번역 실행 전 방향 검증. 감지는 자동 선택의 방향만 정하며, 수동으로 고른 언어는 항상 신뢰한다.
 * 따라서 자동 타겟을 정할 근거가 없을 때만 사용자의 명시 선택을 요구한다.
 */
export function checkDirection(direction: ResolvedDirection): DirectionIssue | null {
  if (!direction.target.language) return 'target-undecided';
  return null;
}
