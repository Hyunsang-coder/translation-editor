import { describe, it, expect } from 'vitest';
import { resolveLayout, getMaxSidebarWidth, type LayoutInput } from './layoutResolver';
import { LAYOUT } from '@/constants/layout';

/** 기본 입력: 1440px 윈도우, 양쪽 사이드바 250px, 프로젝트 확장 */
function makeInput(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    windowWidth: 1440,
    leftSidebar: { hidden: false, panels: ['settings', 'review'], activePanel: 'settings', width: 250 },
    rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 260 },
    projectSidebarCollapsed: false,
    projectSidebarHidden: false,
    ...overrides,
  };
}

describe('resolveLayout', () => {
  it('여유 충분하면 desired 그대로 반환', () => {
    const result = resolveLayout(makeInput());
    // 1440 - 160(project) - 250 - 250 = 780 >= 400(EDITOR_MIN) → OK
    // 좌측 desired 250은 SIDEBAR_MIN(280) 미만이라 280으로 올라간다.
    expect(result).toEqual({ left: LAYOUT.SIDEBAR_MIN, right: 260 });
  });

  it('양쪽 사이드바 600px → 비례 축소', () => {
    const input = makeInput({
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 600 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 600 },
    });
    const result = resolveLayout(input);
    // 1440 - 160 - 400(EDITOR_MIN) = 880 budget for sidebars
    // ratio = 880 / 1200 = 0.733...
    // 600 * 0.733 = 440 → both get 440
    expect(result.left).toBe(440);
    expect(result.right).toBe(440);
    expect(result.left + result.right).toBeLessThanOrEqual(880);
  });

  it('좁은 윈도우(1000px)에서 비례 축소', () => {
    const input = makeInput({
      windowWidth: 1000,
      projectSidebarCollapsed: true, // 48px
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 400 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 400 },
    });
    const result = resolveLayout(input);
    // 1000 - 48(project collapsed) - 400(EDITOR_MIN) = 552 budget
    // ratio = 552 / 800 = 0.69 → 400 * 0.69 = 276
    // 좌측은 SIDEBAR_MIN(280)이 비례 축소값보다 커서 clamp된다.
    expect(result.left).toBe(LAYOUT.SIDEBAR_MIN);
    expect(result.right).toBe(276);
  });

  it('한쪽 숨김 → 숨긴 쪽은 폭 0, 열린 쪽만 조정', () => {
    const input = makeInput({
      windowWidth: 900,
      projectSidebarCollapsed: true,
      leftSidebar: { hidden: true, panels: ['settings'], activePanel: 'settings', width: 400 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    const result = resolveLayout(input);
    // left는 hidden → 0px
    expect(result.left).toBe(0);
    // budget = 900 - 48(project) - 400(editor) = 452
    // budgetForOpen = 452 - 0(left hidden) = 452
    // right desired 500 > 452 → 452
    expect(result.right).toBe(452);
  });

  it('빈 사이드바는 폭 0', () => {
    const input = makeInput({
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 250 },
      rightSidebar: { hidden: false, panels: [], activePanel: null, width: 250 },
    });
    const result = resolveLayout(input);
    expect(result.right).toBe(0);
  });

  it('양쪽 다 숨겨있으면 둘 다 폭 0', () => {
    const input = makeInput({
      leftSidebar: { hidden: true, panels: ['settings'], activePanel: 'settings', width: 500 },
      rightSidebar: { hidden: true, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    const result = resolveLayout(input);
    expect(result.left).toBe(0);
    expect(result.right).toBe(0);
  });

  it('프로젝트 사이드바 숨김 → 더 많은 공간 확보', () => {
    const input = makeInput({
      windowWidth: 1000,
      projectSidebarHidden: true,
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 300 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 300 },
    });
    const result = resolveLayout(input);
    // 1000 - 0(hidden) - 400(editor) = 600 budget
    // 300 + 300 = 600 = budget → 그대로
    expect(result).toEqual({ left: 300, right: 300 });
  });

  it('극단적으로 좁은 윈도우 → SIDEBAR_MIN 보장', () => {
    const input = makeInput({
      windowWidth: 600,
      projectSidebarHidden: true,
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 400 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 400 },
    });
    const result = resolveLayout(input);
    // budget = 600 - 0 - 400 = 200
    // ratio = 200 / 800 = 0.25 → 100px each → 채팅 사이드바는 CHAT_SIDEBAR_MIN=260으로 clamp
    expect(result.left).toBe(LAYOUT.SIDEBAR_MIN);
    expect(result.right).toBe(LAYOUT.CHAT_SIDEBAR_MIN);
  });

  it('비대칭 desired → 비례적으로 축소', () => {
    const input = makeInput({
      windowWidth: 1200,
      projectSidebarCollapsed: false,
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 300 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 600 },
    });
    const result = resolveLayout(input);
    // budget = 1200 - 160 - 400 = 640
    // total desired = 300 + 600 = 900
    // ratio = 640 / 900 = 0.711
    // left: 300 * 0.711 = 213 → SIDEBAR_MIN(280)으로 clamp, right: 600 * 0.711 = 427
    // 최소 너비 clamp는 budget보다 우선한다(채팅 사이드바 clamp와 동일한 기존 동작).
    expect(result.left).toBe(LAYOUT.SIDEBAR_MIN);
    expect(result.right).toBe(427);
  });
});

describe('getMaxSidebarWidth', () => {
  it('반대쪽 사이드바 고려한 최대값 계산', () => {
    const input = makeInput();
    // 1440 - 160(project) - 250(right) - 400(editor) = 630 → min(600, 630) = 600
    expect(getMaxSidebarWidth(input, 'left')).toBe(LAYOUT.SIDEBAR_MAX);
  });

  it('반대쪽이 크면 이쪽 최대값 줄어듦', () => {
    const input = makeInput({
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    // 1440 - 160 - 500 - 400 = 380
    expect(getMaxSidebarWidth(input, 'left')).toBe(380);
  });

  it('반대쪽 숨겨있으면 더 많은 공간', () => {
    const input = makeInput({
      rightSidebar: { hidden: true, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    // 1440 - 160 - 0(hidden) - 400 = 880 → min(600, 880) = 600
    expect(getMaxSidebarWidth(input, 'left')).toBe(LAYOUT.SIDEBAR_MAX);
  });

  it('좁은 윈도우에서 SIDEBAR_MIN 이하로 내려가지 않음', () => {
    const input = makeInput({
      windowWidth: 600,
      projectSidebarHidden: true,
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 300 },
    });
    // 600 - 0 - 300 - 400 = -100 → max(200, -100) = 200
    expect(getMaxSidebarWidth(input, 'left')).toBe(LAYOUT.SIDEBAR_MIN);
  });
});
