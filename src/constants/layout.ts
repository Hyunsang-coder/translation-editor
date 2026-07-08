/**
 * 레이아웃 상수 — 에디터 최소 너비 보장을 위한 단일 출처(single source of truth)
 *
 * 사용처: resolveLayout(), useResizeHandle, useResponsiveLayout, MainLayout
 */
export const LAYOUT = {
  /** 에디터 최소 너비 (px) — 이 이하로 줄어들지 않음 */
  EDITOR_MIN: 400,
  /** 사이드바 최소 너비 (px) — 열려있을 때 */
  SIDEBAR_MIN: 200,
  /** 채팅 패널이 열린 사이드바 최소 너비 (px) — 컴포저 전송 버튼 항상 표시 */
  CHAT_SIDEBAR_MIN: 260,
  /** 사이드바 최대 너비 (px) — 드래그 상한 */
  SIDEBAR_MAX: 600,
  /** ProjectSidebar 기본 확장 너비 (px) */
  PROJECT_EXPANDED: 160,
  /** ProjectSidebar 최소 너비 (px) — 리사이즈 하한 */
  PROJECT_MIN: 160,
  /** ProjectSidebar 최대 너비 (px) — 리사이즈 상한 */
  PROJECT_MAX: 300,
  /** ProjectSidebar 축소 너비 (px) */
  PROJECT_COLLAPSED: 48,
} as const;
