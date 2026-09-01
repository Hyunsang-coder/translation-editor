import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '@/tauri/invoke';
import { isMacPlatform } from '@/utils/platform';

/**
 * 통합 타이틀바(`titleBarStyle: "Overlay"`)에서 신호등이 가리는 좌측 폭.
 *
 * 네이티브 타이틀바를 없애면 신호등이 툴바 위로 겹쳐 오므로 그만큼 비워야 한다.
 * 전체화면에서는 신호등이 사라지니 여백도 함께 접는다 — 안 접으면 좌측이 78px 빈다.
 *
 * macOS 전용이다. `titleBarStyle`은 다른 플랫폼에서 무시되므로 여백도 주지 않는다.
 */
const MACOS_TRAFFIC_LIGHT_WIDTH = 78;

export function useTrafficLightInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!isTauriRuntime() || !isMacPlatform()) return;

    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const sync = async (): Promise<void> => {
      try {
        const fullscreen = await appWindow.isFullscreen();
        if (!cancelled) setInset(fullscreen ? 0 : MACOS_TRAFFIC_LIGHT_WIDTH);
      } catch {
        // 창 상태를 못 읽으면 여백을 주는 쪽이 안전하다 — 없으면 신호등이 컨트롤을 덮는다.
        if (!cancelled) setInset(MACOS_TRAFFIC_LIGHT_WIDTH);
      }
    };

    void sync();
    // 전체화면 진입·해제는 리사이즈로 관측된다.
    void appWindow.onResized(() => { void sync(); }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return inset;
}
