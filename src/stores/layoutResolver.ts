/**
 * 레이아웃 제약 해결기 (Layout Resolver)
 *
 * 사이드바의 desired width와 윈도우 크기로부터
 * 에디터 최소 너비(EDITOR_MIN)를 보장하는 effective width를 계산한다.
 *
 * 순수 함수이므로 어디서든 호출 가능하고 테스트가 간단하다.
 */
import { LAYOUT } from '@/constants/layout';
import type { DockingSidebarState } from '@/types';

export interface LayoutInput {
  windowWidth: number;
  leftSidebar: DockingSidebarState;
  rightSidebar: DockingSidebarState;
  projectSidebarCollapsed: boolean;
  projectSidebarHidden: boolean;
  projectSidebarWidth?: number;
}

export interface ResolvedWidths {
  left: number;
  right: number;
}

/** 사이드바가 차지하는 desired 너비 (접힘/빈 상태 포함) */
function getDesiredWidth(sidebar: DockingSidebarState): number {
  if (sidebar.panels.length === 0) return LAYOUT.SIDEBAR_EMPTY;
  if (sidebar.collapsed) return LAYOUT.SIDEBAR_COLLAPSED;
  return sidebar.width;
}

/** ProjectSidebar가 차지하는 너비 */
function getProjectWidth(hidden: boolean, collapsed: boolean, width?: number): number {
  if (hidden) return 0;
  return collapsed ? LAYOUT.PROJECT_COLLAPSED : (width ?? LAYOUT.PROJECT_EXPANDED);
}

/**
 * 양쪽 사이드바의 effective width를 계산한다.
 *
 * 로직:
 * 1. 접힌/빈 사이드바는 고정 크기 그대로 반환
 * 2. 열린 사이드바의 desired 합이 budget 이내면 그대로
 * 3. 초과하면 비례 축소 (SIDEBAR_MIN까지)
 */
export function resolveLayout(input: LayoutInput): ResolvedWidths {
  const projectW = getProjectWidth(input.projectSidebarHidden, input.projectSidebarCollapsed, input.projectSidebarWidth);
  const leftDesired = getDesiredWidth(input.leftSidebar);
  const rightDesired = getDesiredWidth(input.rightSidebar);

  const leftOpen = input.leftSidebar.panels.length > 0 && !input.leftSidebar.collapsed;
  const rightOpen = input.rightSidebar.panels.length > 0 && !input.rightSidebar.collapsed;

  // 열린 사이드바가 없으면 그대로
  if (!leftOpen && !rightOpen) {
    return { left: leftDesired, right: rightDesired };
  }

  const sidebarBudget = input.windowWidth - projectW - LAYOUT.EDITOR_MIN;

  // 고정 부분 (접힌 사이드바)을 먼저 빼고 열린 사이드바에 배분
  const fixedLeft = leftOpen ? 0 : leftDesired;
  const fixedRight = rightOpen ? 0 : rightDesired;
  const budgetForOpen = sidebarBudget - fixedLeft - fixedRight;

  const openLeftDesired = leftOpen ? leftDesired : 0;
  const openRightDesired = rightOpen ? rightDesired : 0;
  const totalOpenDesired = openLeftDesired + openRightDesired;

  // 여유 충분 → desired 그대로
  if (totalOpenDesired <= budgetForOpen) {
    return { left: leftDesired, right: rightDesired };
  }

  // 비례 축소
  const ratio = budgetForOpen > 0 ? budgetForOpen / totalOpenDesired : 0;
  const leftEffective = leftOpen
    ? Math.max(LAYOUT.SIDEBAR_MIN, Math.round(openLeftDesired * ratio))
    : leftDesired;
  const rightEffective = rightOpen
    ? Math.max(LAYOUT.SIDEBAR_MIN, Math.round(openRightDesired * ratio))
    : rightDesired;

  return { left: leftEffective, right: rightEffective };
}

/**
 * 특정 사이드의 리사이즈 상한을 계산한다.
 * 드래그 중 반대편 사이드바와 에디터 최소 너비를 고려한다.
 */
export function getMaxSidebarWidth(input: LayoutInput, side: 'left' | 'right'): number {
  const projectW = getProjectWidth(input.projectSidebarHidden, input.projectSidebarCollapsed, input.projectSidebarWidth);
  const otherSidebar = side === 'left' ? input.rightSidebar : input.leftSidebar;
  const otherW = getDesiredWidth(otherSidebar);
  const max = input.windowWidth - projectW - otherW - LAYOUT.EDITOR_MIN;
  return Math.min(LAYOUT.SIDEBAR_MAX, Math.max(LAYOUT.SIDEBAR_MIN, max));
}
