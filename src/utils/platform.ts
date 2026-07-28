/**
 * 플랫폼 판별 유틸
 *
 * 단축키 칩 라벨 등 UI 표기에만 사용한다.
 * 실제 키 핸들링은 `e.metaKey || e.ctrlKey` 로 양쪽을 모두 받는다.
 */

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.userAgent);
}

/** 수정자 키 라벨 — macOS는 `⌘`, 그 외는 `Ctrl` */
export function modKeyLabel(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl+';
}

/** `⌘T` / `Ctrl+T` 형태의 단축키 라벨 */
export function shortcutLabel(key: string): string {
  return `${modKeyLabel()}${key}`;
}
