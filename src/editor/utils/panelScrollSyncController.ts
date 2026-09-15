let suppressionCount = 0;

export function isPanelScrollSyncSuppressed(): boolean {
  return suppressionCount > 0;
}

function afterTwoAnimationFrames(callback: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(callback, 0);
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

/**
 * 양쪽 패널을 명시적으로 함께 이동하는 검수 네비게이션 같은 경로를 보호한다.
 * 프로그램 scroll 이벤트가 모두 전달될 때까지 두 프레임 기다려 자동 동기화의
 * feedback loop를 막는다.
 */
export function withPanelScrollSyncSuppressed(callback: () => void): void {
  suppressionCount += 1;
  try {
    callback();
  } finally {
    afterTwoAnimationFrames(() => {
      suppressionCount = Math.max(0, suppressionCount - 1);
    });
  }
}
