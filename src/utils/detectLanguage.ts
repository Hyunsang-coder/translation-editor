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
