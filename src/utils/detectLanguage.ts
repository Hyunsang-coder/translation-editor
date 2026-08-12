/**
 * 텍스트의 언어 감지 (한글/영문/일본어/중국어 문자 비율 휴리스틱).
 *
 * 원래 `ReviewPanel.tsx`에 있던 함수를 정렬 뷰와 공유하려고 올렸다.
 * 반환값은 검수 프롬프트의 `sourceLanguage`로 그대로 들어가므로 기존 문자열을 유지한다.
 */
export function detectSourceLanguage(text: string): string {
  const sampleText = text.slice(0, 500);

  if (!sampleText.trim()) return '원문';

  // 각 문자 체계 비율 계산
  const koreanChars = (sampleText.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const japaneseChars = (sampleText.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const chineseChars = (sampleText.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latinChars = (sampleText.match(/[a-zA-Z]/g) || []).length;

  const total = koreanChars + japaneseChars + chineseChars + latinChars;
  if (total === 0) return '원문';

  const koreanRatio = koreanChars / total;
  const japaneseRatio = japaneseChars / total;
  const chineseRatio = chineseChars / total;
  const latinRatio = latinChars / total;

  // 가장 높은 비율의 언어 반환
  if (koreanRatio > 0.3) return 'Korean';
  if (japaneseRatio > 0.3) return 'Japanese';
  if (chineseRatio > 0.3) return 'Chinese';
  if (latinRatio > 0.5) return 'English';

  return '원문';
}

/**
 * 표 헤더용 언어 코드. `detectSourceLanguage`의 반환값과 프로젝트 설정의
 * 대상 언어(한국어 표기)를 모두 받는다. 모르는 언어면 null — 코드 없이 표시한다.
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
 * 언어 이름을 비교 가능한 코드로 정규화한다. Select 값은 한글 라벨('한국어'),
 * `detectSourceLanguage` 반환값은 영문명('Korean')이라 **문자열끼리 비교하면 영원히 안 맞는다** —
 * 방향 판정은 반드시 이 함수를 거친 값으로 한다.
 */
export function normalizeLang(language: string | null | undefined): string | null {
  return languageShortCode(language)?.toLowerCase() ?? null;
}

/** 두 언어명이 같은 언어를 가리키는가. 한쪽이라도 모르는 언어면 false(가드를 걸지 않는다). */
export function isSameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeLang(a);
  return na !== null && na === normalizeLang(b);
}

/** 타겟 언어 Select의 '자동' 항목 값. 프로젝트에는 이 센티널이 그대로 저장된다. */
export const AUTO_TARGET_LANGUAGE = 'auto';

/** 자동 판정 표본 길이. 500자는 표 헤더·영문 제목만 걸려 오판이 나서 넉넉히 잡는다. */
const AUTO_SAMPLE_CHARS = 4000;

/**
 * 자동 방향 결정 전용 원문 판정 — KO/EN만 답하고 나머지는 null.
 *
 * `detectSourceLanguage`의 비율 임계(한글 30%)와 달리 **한글이 있는지**를 본다.
 * 영문 문서의 한글은 0%지만 영어 용어가 범벅인 국문 문서도 한글이 5% 밑으로는 잘 안 내려가는
 * 비대칭 신호라, L10N 표처럼 두 언어가 섞인 문서에서 비율 임계보다 훨씬 안정적이다.
 * 일본어·중국어는 자동 결정 대상에서 빼고 null → 호출부가 명시 선택을 요구한다.
 */
export function detectSourceLangCode(text: string): 'ko' | 'en' | null {
  const sample = String(text ?? '').slice(0, AUTO_SAMPLE_CHARS);
  if (!sample.trim()) return null;

  const hangul = (sample.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const kana = (sample.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const han = (sample.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;

  const total = hangul + kana + han + latin;
  if (total === 0) return null;

  if (kana / total >= 0.05) return null; // 일본어
  if (hangul / total >= 0.05) return 'ko';
  if (han / total >= 0.1) return null; // 중국어
  if (latin / total >= 0.5) return 'en';
  return null;
}

export interface ResolvedTargetLanguage {
  /** 프롬프트·표시에 쓸 언어명. 자동인데 판정 실패면 null. */
  language: string | null;
  /** 감지로 푼 값이면 true (UI에 "자동 (영어)"로 밝히고, 저장값은 여전히 'auto') */
  auto: boolean;
}

/**
 * 저장된 타겟 언어를 실제 언어명으로 해석한다.
 *
 * 저장값이 '자동'이거나 비어 있으면 원문을 감지해 반대 언어로 넘긴다(국문→영어, 영문→한국어).
 * **`metadata.targetLanguage`를 프롬프트·MCP로 흘리는 모든 경로는 이 함수를 거쳐야 한다** —
 * 안 그러면 센티널 문자열 'auto'가 그대로 프롬프트에 박힌다.
 */
export function resolveTargetLanguage(
  stored: string | null | undefined,
  sourceText: string,
): ResolvedTargetLanguage {
  const trimmed = stored?.trim();
  if (trimmed && trimmed !== AUTO_TARGET_LANGUAGE) {
    return { language: trimmed, auto: false };
  }

  const source = detectSourceLangCode(sourceText);
  if (source === 'ko') return { language: '영어', auto: true };
  if (source === 'en') return { language: '한국어', auto: true };
  return { language: null, auto: true };
}
