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
import { isChatPanel } from '@/types';

export interface LayoutInput {
  windowWidth: number;
  leftSidebar: DockingSidebarState;
  rightSidebar: DockingSidebarState;
}

export interface ResolvedWidths {
  left: number;
  right: number;
}

/** 사이드바가 차지하는 desired 너비 (숨김/빈 상태 포함) */
function getDesiredWidth(sidebar: DockingSidebarState): number {
  if (sidebar.hidden) return 0;            // 완전 숨김 최우선
  if (sidebar.panels.length === 0) return 0; // 빈 바도 폭 0
  return sidebar.width;
}

/** 열린 사이드바의 최소 너비 (채팅 패널 포함 시 더 넓게) */
function getOpenSidebarMinWidth(sidebar: DockingSidebarState): number {
  return sidebar.panels.some(isChatPanel) ? LAYOUT.CHAT_SIDEBAR_MIN : LAYOUT.SIDEBAR_MIN;
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
  const leftDesired = getDesiredWidth(input.leftSidebar);
  const rightDesired = getDesiredWidth(input.rightSidebar);

  const leftOpen = input.leftSidebar.panels.length > 0 && !input.leftSidebar.hidden;
  const rightOpen = input.rightSidebar.panels.length > 0 && !input.rightSidebar.hidden;

  // 열린 사이드바가 없으면 그대로
  if (!leftOpen && !rightOpen) {
    return { left: leftDesired, right: rightDesired };
  }

  const sidebarBudget = input.windowWidth - LAYOUT.EDITOR_MIN;

  // 고정 부분 (접힌 사이드바)을 먼저 빼고 열린 사이드바에 배분
  const fixedLeft = leftOpen ? 0 : leftDesired;
  const fixedRight = rightOpen ? 0 : rightDesired;
  const budgetForOpen = sidebarBudget - fixedLeft - fixedRight;

  const openLeftDesired = leftOpen ? leftDesired : 0;
  const openRightDesired = rightOpen ? rightDesired : 0;
  const totalOpenDesired = openLeftDesired + openRightDesired;

  // 여유 충분 → desired 그대로 (단, 열린 사이드바는 패널 유형별 최소 너비 보장)
  if (totalOpenDesired <= budgetForOpen) {
    return {
      left: leftOpen ? Math.max(getOpenSidebarMinWidth(input.leftSidebar), leftDesired) : leftDesired,
      right: rightOpen ? Math.max(getOpenSidebarMinWidth(input.rightSidebar), rightDesired) : rightDesired,
    };
  }

  // 비례 축소
  const ratio = budgetForOpen > 0 ? budgetForOpen / totalOpenDesired : 0;
  const leftEffective = leftOpen
    ? Math.max(getOpenSidebarMinWidth(input.leftSidebar), Math.round(openLeftDesired * ratio))
    : leftDesired;
  const rightEffective = rightOpen
    ? Math.max(getOpenSidebarMinWidth(input.rightSidebar), Math.round(openRightDesired * ratio))
    : rightDesired;

  return { left: leftEffective, right: rightEffective };
}

/**
 * 특정 사이드의 리사이즈 상한을 계산한다.
 * 드래그 중 반대편 사이드바와 에디터 최소 너비를 고려한다.
 */
export function getMaxSidebarWidth(input: LayoutInput, side: 'left' | 'right'): number {
  const sidebar = side === 'left' ? input.leftSidebar : input.rightSidebar;
  const otherSidebar = side === 'left' ? input.rightSidebar : input.leftSidebar;
  const otherW = getDesiredWidth(otherSidebar);
  const minW = getOpenSidebarMinWidth(sidebar);
  const max = input.windowWidth - otherW - LAYOUT.EDITOR_MIN;
  return Math.min(LAYOUT.SIDEBAR_MAX, Math.max(minW, max));
}
