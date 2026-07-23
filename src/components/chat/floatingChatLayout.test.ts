import { describe, expect, it } from 'vitest';
import { clampFloatingChatRect, resizeFloatingChatRect } from './floatingChatLayout';

describe('clampFloatingChatRect', () => {
  it('패널을 컨테이너 경계 안으로 제한한다', () => {
    expect(clampFloatingChatRect(
      { x: 900, y: 700, width: 420, height: 560 },
      { width: 1000, height: 800 },
    )).toEqual({ x: 580, y: 240, width: 420, height: 560 });
  });

  it('작은 컨테이너에서는 크기와 위치를 함께 줄인다', () => {
    expect(clampFloatingChatRect(
      { x: -20, y: -10, width: 600, height: 700 },
      { width: 360, height: 420 },
    )).toEqual({ x: 0, y: 0, width: 360, height: 420 });
  });

  it('최소 크기를 유지하되 컨테이너보다 커지지는 않는다', () => {
    expect(clampFloatingChatRect(
      { x: 10, y: 10, width: 100, height: 120 },
      { width: 900, height: 700 },
    )).toEqual({ x: 10, y: 10, width: 320, height: 360 });
  });
});

describe('resizeFloatingChatRect', () => {
  const rect = { x: 100, y: 80, width: 400, height: 500 };
  const bounds = { width: 1000, height: 800 };

  it('오른쪽과 아래쪽 가장자리로 크기를 늘린다', () => {
    expect(resizeFloatingChatRect(rect, 'se', 120, 80, bounds))
      .toEqual({ x: 100, y: 80, width: 520, height: 580 });
  });

  it('왼쪽 가장자리는 오른쪽 위치를 유지하며 크기를 바꾼다', () => {
    expect(resizeFloatingChatRect(rect, 'w', 60, 0, bounds))
      .toEqual({ x: 160, y: 80, width: 340, height: 500 });
  });

  it('위쪽 가장자리는 아래쪽 위치를 유지하며 크기를 바꾼다', () => {
    expect(resizeFloatingChatRect(rect, 'n', 0, 50, bounds))
      .toEqual({ x: 100, y: 130, width: 400, height: 450 });
  });

  it('좌측 상단 모서리에서 너비와 높이를 동시에 바꾼다', () => {
    expect(resizeFloatingChatRect(rect, 'nw', -40, -30, bounds))
      .toEqual({ x: 60, y: 50, width: 440, height: 530 });
  });

  it('반대쪽 가장자리를 유지하면서 최소 크기에서 멈춘다', () => {
    expect(resizeFloatingChatRect(rect, 'nw', 300, 300, bounds))
      .toEqual({ x: 180, y: 220, width: 320, height: 360 });
  });

  it('패널을 컨테이너 바깥으로 늘리지 않는다', () => {
    expect(resizeFloatingChatRect(rect, 'se', 900, 900, bounds))
      .toEqual({ x: 100, y: 80, width: 900, height: 720 });
  });
});
