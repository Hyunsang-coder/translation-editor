/** Tauri testing bridge가 활성화되어 있는지 확인 */
export function isTauriTestingBridgeActive(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_TESTING_BRIDGE__?: unknown };
  return typeof w.__TAURI_TESTING_BRIDGE__ === 'object' && w.__TAURI_TESTING_BRIDGE__ !== null;
}
