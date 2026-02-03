/**
 * Fuzzy matching utility for review apply fallback
 *
 * AI가 targetExcerpt를 정확히 복사하지 않아 정확한 매칭이 실패할 때
 * Levenshtein distance 기반 퍼지 매칭으로 폴백합니다.
 */

export interface FuzzyMatchResult {
  /** 매칭 시작 위치 (원본 텍스트 인덱스) */
  index: number;
  /** 매칭 길이 */
  length: number;
  /** 유사도 (0-1, 1이 완전 일치) */
  score: number;
  /** 실제 매칭된 텍스트 */
  matchedText: string;
}

/**
 * Levenshtein distance 계산 (Wagner-Fischer 알고리즘)
 * 두 문자열 사이의 편집 거리를 계산합니다.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // 빈 문자열 처리
  if (m === 0) return n;
  if (n === 0) return m;

  // DP 테이블 (메모리 최적화: 2행만 사용)
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,      // 삭제
        curr[j - 1]! + 1,  // 삽입
        prev[j - 1]! + cost // 치환
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n]!;
}

/**
 * Levenshtein 유사도 계산 (0-1)
 * 1에 가까울수록 두 문자열이 유사합니다.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);

  return 1 - distance / maxLen;
}

/**
 * 슬라이딩 윈도우로 최적 퍼지 매칭 위치 찾기
 *
 * 텍스트 내에서 검색어와 가장 유사한 부분을 찾습니다.
 * 윈도우 크기를 검색어 길이 ±20% 범위로 조절하여 탐색합니다.
 *
 * @param text - 검색 대상 텍스트
 * @param searchTerm - 찾을 검색어
 * @param threshold - 최소 유사도 임계값 (기본 0.7 = 70%)
 * @returns 가장 유사한 매칭 결과, 임계값 미달 시 null
 */
export function findBestFuzzyMatch(
  text: string,
  searchTerm: string,
  threshold: number = 0.7
): FuzzyMatchResult | null {
  if (!text || !searchTerm) return null;

  const searchLen = searchTerm.length;
  const textLen = text.length;

  if (searchLen === 0 || textLen === 0) return null;

  // 검색어가 텍스트보다 긴 경우: 텍스트 전체를 후보로 비교
  if (searchLen > textLen) {
    const score = levenshteinSimilarity(searchTerm.toLowerCase(), text.toLowerCase());
    if (score >= threshold) {
      return {
        index: 0,
        length: textLen,
        score,
        matchedText: text,
      };
    }
    return null;
  }

  // 윈도우 크기 범위: 검색어 길이 ±30% (AI가 추가/누락할 수 있는 문자 고려)
  const minWindowSize = Math.max(1, Math.floor(searchLen * 0.7));
  const maxWindowSize = Math.min(textLen, Math.ceil(searchLen * 1.3));

  let bestMatch: FuzzyMatchResult | null = null;
  let bestScore = threshold - 0.0001; // 임계값 이상(>=)만 유효

  // 대소문자 무시 비교를 위한 정규화
  const searchLower = searchTerm.toLowerCase();
  const textLower = text.toLowerCase();

  // 성능 최적화: 너무 긴 텍스트는 청크로 나눠서 처리
  const maxIterations = 10000;
  let iterations = 0;

  for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
    for (let i = 0; i <= textLen - windowSize; i++) {
      if (++iterations > maxIterations) break;

      const window = textLower.slice(i, i + windowSize);
      const score = levenshteinSimilarity(searchLower, window);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          index: i,
          length: windowSize,
          score,
          matchedText: text.slice(i, i + windowSize),
        };

        // 완전 일치 발견 시 즉시 반환
        if (score === 1) return bestMatch;
      }
    }
    if (iterations > maxIterations) break;
  }

  return bestMatch;
}

/**
 * 문서 내 모든 퍼지 매칭 찾기 (단일 결과만 반환하는 간단 버전)
 *
 * SearchHighlight에서 사용하기 위한 wrapper.
 * 현재는 가장 유사한 단일 결과만 반환합니다.
 */
export function findFuzzyMatches(
  text: string,
  searchTerm: string,
  threshold: number = 0.7
): FuzzyMatchResult[] {
  const match = findBestFuzzyMatch(text, searchTerm, threshold);
  return match ? [match] : [];
}
