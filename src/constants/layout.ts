/**
 * 레이아웃 상수 — 에디터 최소 너비 보장을 위한 단일 출처(single source of truth)
 *
 * 사용처: resolveLayout(), useResizeHandle, useResponsiveLayout, MainLayout
 */
export const LAYOUT = {
  /** 에디터 최소 너비 (px) — 이 이하로 줄어들지 않음 */
  EDITOR_MIN: 400,
  /** 사이드바 최소 너비 (px) — 열려있을 때. 검수 이슈 카드가 잘리지 않는 하한 */
  SIDEBAR_MIN: 280,
  /** 채팅 패널이 열린 사이드바 최소 너비 (px) — 컴포저 전송 버튼 항상 표시 */
  CHAT_SIDEBAR_MIN: 260,
  /** 사이드바 최대 너비 (px) — 드래그 상한 */
  SIDEBAR_MAX: 600,
} as const;
