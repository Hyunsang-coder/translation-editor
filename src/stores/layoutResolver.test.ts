import { describe, it, expect } from 'vitest';
import { resolveLayout, getMaxSidebarWidth, type LayoutInput } from './layoutResolver';
import { LAYOUT } from '@/constants/layout';

/** 기본 입력: 1440px 윈도우, 좌 250px / 우 260px */
function makeInput(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    windowWidth: 1440,
    leftSidebar: { hidden: false, panels: ['settings', 'review'], activePanel: 'settings', width: 250 },
    rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 260 },
    ...overrides,
  };
}

describe('resolveLayout', () => {
  it('여유 충분하면 desired 그대로 반환', () => {
    const result = resolveLayout(makeInput());
    // budget = 1440 - 400(EDITOR_MIN) = 1040 >= 250 + 260 → OK
    // 좌측 desired 250은 SIDEBAR_MIN(280) 미만이라 280으로 올라간다.
    expect(result).toEqual({ left: LAYOUT.SIDEBAR_MIN, right: 260 });
  });

  it('양쪽 사이드바 600px → 비례 축소', () => {
    const input = makeInput({
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 600 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 600 },
    });
    const result = resolveLayout(input);
    // budget = 1440 - 400(EDITOR_MIN) = 1040
    // ratio = 1040 / 1200 = 0.866... → 600 * 0.866 = 520
    expect(result.left).toBe(520);
    expect(result.right).toBe(520);
    expect(result.left + result.right).toBeLessThanOrEqual(1040);
  });

  it('좁은 윈도우(1000px)에서 비례 축소', () => {
    const input = makeInput({
      windowWidth: 1000,
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 400 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 400 },
    });
    const result = resolveLayout(input);
    // budget = 1000 - 400(EDITOR_MIN) = 600
    // ratio = 600 / 800 = 0.75 → 400 * 0.75 = 300 (둘 다 최소 너비 위)
    expect(result.left).toBe(300);
    expect(result.right).toBe(300);
  });

  it('한쪽 숨김 → 숨긴 쪽은 폭 0, 열린 쪽만 조정', () => {
    const input = makeInput({
      windowWidth: 900,
      leftSidebar: { hidden: true, panels: ['settings'], activePanel: 'settings', width: 400 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    const result = resolveLayout(input);
    // left는 hidden → 0px
    expect(result.left).toBe(0);
    // budget = 900 - 400(editor) = 500, budgetForOpen = 500 → desired 500 그대로
    expect(result.right).toBe(500);
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

  it('극단적으로 좁은 윈도우 → SIDEBAR_MIN 보장', () => {
    const input = makeInput({
      windowWidth: 600,
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 400 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 400 },
    });
    const result = resolveLayout(input);
    // budget = 600 - 400 = 200
    // ratio = 200 / 800 = 0.25 → 100px each → 채팅 사이드바는 CHAT_SIDEBAR_MIN=260으로 clamp
    expect(result.left).toBe(LAYOUT.SIDEBAR_MIN);
    expect(result.right).toBe(LAYOUT.CHAT_SIDEBAR_MIN);
  });

  it('비대칭 desired → 비례적으로 축소', () => {
    const input = makeInput({
      windowWidth: 1200,
      leftSidebar: { hidden: false, panels: ['settings'], activePanel: 'settings', width: 300 },
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 600 },
    });
    const result = resolveLayout(input);
    // budget = 1200 - 400 = 800, total desired = 900, ratio = 0.888...
    // left: 300 * 0.889 = 267 → SIDEBAR_MIN(280)으로 clamp, right: 600 * 0.889 = 533
    // 최소 너비 clamp는 budget보다 우선한다(채팅 사이드바 clamp와 동일한 기존 동작).
    expect(result.left).toBe(LAYOUT.SIDEBAR_MIN);
    expect(result.right).toBe(533);
  });
});

describe('getMaxSidebarWidth', () => {
  it('반대쪽 사이드바 고려한 최대값 계산', () => {
    const input = makeInput();
    // 1440 - 260(right) - 400(editor) = 780 → min(600, 780) = 600
    expect(getMaxSidebarWidth(input, 'left')).toBe(LAYOUT.SIDEBAR_MAX);
  });

  it('반대쪽이 크면 이쪽 최대값 줄어듦', () => {
    const input = makeInput({
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    // 1440 - 500 - 400 = 540
    expect(getMaxSidebarWidth(input, 'left')).toBe(540);
  });

  it('반대쪽 숨겨있으면 더 많은 공간', () => {
    const input = makeInput({
      rightSidebar: { hidden: true, panels: ['chat:1'], activePanel: 'chat:1', width: 500 },
    });
    // 1440 - 0(hidden) - 400 = 1040 → min(600, 1040) = 600
    expect(getMaxSidebarWidth(input, 'left')).toBe(LAYOUT.SIDEBAR_MAX);
  });

  it('좁은 윈도우에서 SIDEBAR_MIN 이하로 내려가지 않음', () => {
    const input = makeInput({
      windowWidth: 600,
      rightSidebar: { hidden: false, panels: ['chat:1'], activePanel: 'chat:1', width: 300 },
    });
    // 600 - 300 - 400 = -100 → max(SIDEBAR_MIN, -100) = SIDEBAR_MIN
    expect(getMaxSidebarWidth(input, 'left')).toBe(LAYOUT.SIDEBAR_MIN);
  });
});
