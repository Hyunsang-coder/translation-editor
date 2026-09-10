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

/** 자동 방향 판정 표본. 500자는 표 헤더·영문 제목만 걸려 오판이 나서 넉넉히 잡는다. */
const AUTO_SAMPLE_CHARS = 4000;

/**
 * 방향 판정에 쓸 원문 표본을 HTML에서 뽑는다.
 * 태그가 부풀리는 몫을 감안해 넉넉히 자른 뒤 벗긴다(판정기가 다시 자기 표본 길이로 자른다).
 */
export function sourceSampleFromHtml(html: string | null | undefined): string {
  return stripHtml((html || '').slice(0, 12_000));
}

/** 보수 판정 표본. 종전 동작을 그대로 보존하려고 500자를 유지한다. */
const DOMINANT_SAMPLE_CHARS = 500;

/**
 * **자동 방향 결정 전용** 원문 판정 — KO/EN만 답하고 나머지는 null.
 *
 * 비율 다수결이 아니라 **한글이 있는지**를 본다. 영문 문서의 한글은 0%지만 영어 용어가
 * 범벅인 국문 문서도 한글이 5% 밑으로는 잘 안 내려가는 비대칭 신호라, L10N 표처럼 두 언어가
 * 섞인 문서에서 비율 임계보다 훨씬 안정적이다. 일본어·중국어는 자동 결정 대상에서 빼고
 * null → 호출부가 명시 선택을 요구한다.
 *
 * **차단 가드에는 쓰지 말 것.** 임계가 공격적이라(한글 5%) 한국어 용어가 섞인 영문 문서를
 * 'ko'로 본다. 방향을 고르는 데는 그 편이 안전하지만, 정당한 번역을 막는 데 쓰면
 * 오탐이 곧 차단이 된다 — 차단 판단은 `detectDominantLangCode`가 한다.
 */
export function detectSourceLangCode(text: string): 'ko' | 'en' | null {
  const sample = String(text ?? '').slice(0, AUTO_SAMPLE_CHARS);
  if (!sample.trim()) return null;

  const hangul = (sample.match(/[가-힯ᄀ-ᇿ]/g) || []).length;
  const kana = (sample.match(/[぀-ゟ゠-ヿ]/g) || []).length;
  const han = (sample.match(/[一-鿿]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;

  const total = hangul + kana + han + latin;
  if (total === 0) return null;

  if (kana / total >= 0.05) return null; // 일본어
  if (hangul / total >= 0.05) return 'ko';
  if (han / total >= 0.1) return null; // 중국어
  if (latin / total >= 0.5) return 'en';
  return null;
}

/**
 * **차단 가드 전용** 보수 판정 — 문서를 지배하는 문자 체계를 비율 다수결로 고른다.
 *
 * `detectSourceLangCode`와 답이 갈릴 수 있고, 그게 의도다. 한국어 용어가 5%쯤 섞인 영문
 * 문서를 저쪽은 'ko'로 보지만 여기서는 'en'이다 — 번역을 **막을지** 정하는 자리에서는
 * 오탐 비용이 훨씬 비싸므로 확실할 때만 답한다. 임계·표본은 종전 동작 그대로다.
 */
export function detectDominantLangCode(text: string): LangCode | null {
  const sample = String(text ?? '').slice(0, DOMINANT_SAMPLE_CHARS);
  if (!sample.trim()) return null;

  const korean = (sample.match(/[가-힯ᄀ-ᇿ]/g) || []).length;
  const japanese = (sample.match(/[぀-ゟ゠-ヿ]/g) || []).length;
  const chinese = (sample.match(/[一-鿿]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;

  const total = korean + japanese + chinese + latin;
  if (total === 0) return null;

  if (korean / total > 0.3) return 'ko';
  if (japanese / total > 0.3) return 'ja';
  if (chinese / total > 0.3) return 'zh';
  if (latin / total > 0.5) return 'en';
  return null;
}

/**
 * 자동일 때 표시·프롬프트에 쓸 원문 언어.
 *
 * 방향 판정기를 먼저 본다 — **라벨이 실제로 쓰이는 방향과 어긋나면 안 되기 때문**이다.
 * (국문에 영어 용어가 범벅인 문서에서 보수 판정은 '영어', 방향은 ko→en을 고르는데,
 * 라벨만 '영어'로 띄우면 헤더가 "영어 → 영어"로 읽힌다.)
 * 방향 판정기가 기권하는 일본어·중국어에서만 보수 판정으로 내려간다.
 */
function detectSourceLabel(text: string): string | null {
  const code = detectSourceLangCode(text) ?? detectDominantLangCode(text);
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
export type DirectionIssue = 'target-undecided' | 'source-mismatch' | 'same-language';

/** 보수 판정기가 표현할 수 있는 언어인가. 스페인어·러시아어는 판정 대상이 아니라 대조하지 않는다. */
function isDetectable(code: string | null): code is LangCode {
  return code === 'ko' || code === 'en' || code === 'ja' || code === 'zh';
}

/**
 * 번역 실행 전 방향 검증 — 문제가 없으면 null.
 *
 * **차단 판단은 전부 `detectDominantLangCode`(보수)로 한다.** 방향을 *고르는* 데 쓰는
 * `detectSourceLangCode`는 임계가 공격적이라, 한국어 용어가 섞인 영문 문서를 'ko'로 보고
 * 정당한 EN→KO 번역을 막아버린다.
 */
export function checkDirection(direction: ResolvedDirection, sourceText: string): DirectionIssue | null {
  if (!direction.target.language) return 'target-undecided';

  const dominant = detectDominantLangCode(sourceText);

  // 명시 선택한 원문 언어가 문서와 어긋난다 — 복사본에 굳은 스테일 값이 여기서 잡힌다.
  // 자동은 정의상 자기 자신과 모순될 수 없어 이 갈래는 명시 선택에서만 작동한다.
  if (!direction.source.auto) {
    const declared = normalizeLang(direction.source.language);
    if (isDetectable(declared) && dominant && declared !== dominant) return 'source-mismatch';
  }

  // 같은 언어로 번역시키면 모델이 원문을 되받아쓴다.
  const sourceForGuard = direction.source.auto
    ? (dominant && LABEL_BY_CODE[dominant]) || null
    : direction.source.language;
  if (isSameLanguage(sourceForGuard, direction.target.language)) return 'same-language';

  return null;
}
