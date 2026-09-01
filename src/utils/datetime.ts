/**
 * 시각 표기 유틸 — 앱 전체에서 시:분을 쓰는 곳은 전부 여기를 거친다.
 *
 * 이전에는 호출부마다 형식이 달랐다: StatusStrip은 24시간 0패딩("17:18"),
 * historyStore·HistoryRestoreDialog는 hour:'2-digit'("오후 05:18"),
 * ChatMessageItem은 'ko-KR' 하드코딩(앱 언어를 영어로 바꿔도 한국어). 같은 상태 줄에
 * 두 형식이 나란히 찍혀 있었다.
 *
 * 12/24시간과 오전·오후 표기는 언어가 아니라 지역 설정이므로, 로케일은 앱 언어가 아니라
 * 시스템(WKWebView가 macOS 지역 설정을 따른다)을 쓴다. locales 인자는 테스트 전용이다.
 */
export function formatTimeOfDay(
  value: number | Date,
  locales?: Intl.LocalesArgument,
): string {
  const date = value instanceof Date ? value : new Date(value);
  // timeStyle:'short' — 로케일마다 다른 패딩 관례를 그대로 따른다.
  // 12시간 로케일은 "오후 5:18"(0을 덧대지 않고), 24시간 로케일은 "05:07"(덧대고).
  // hour:'2-digit'은 12시간 쪽을 "오후 05:18"로, hour:'numeric'은 24시간 쪽을 "5:07"로
  // 망가뜨린다. macOS의 '24시간 표기' 토글도 이 경로로 반영된다.
  return date.toLocaleTimeString(locales ?? [], { timeStyle: 'short' });
}
