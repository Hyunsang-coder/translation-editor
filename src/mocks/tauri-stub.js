/**
 * Tauri API Stub for Web Build
 *
 * 웹 빌드에서 Tauri 모듈 import가 실패하지 않도록 빈 구현을 제공합니다.
 * 실제 Tauri 기능은 플랫폼 추상화 레이어(src/platform/)에서 처리합니다.
 */

// @tauri-apps/api/core
export const invoke = async () => {
  throw new Error('Tauri invoke not available in web build');
};

// @tauri-apps/api/window
export const getCurrentWindow = () => ({
  listen: () => Promise.resolve(() => {}),
  onCloseRequested: () => Promise.resolve(() => {}),
});

export const Window = class {
  static getCurrent() {
    return getCurrentWindow();
  }
};

// @tauri-apps/api/webview
export const getCurrentWebview = () => ({});

// @tauri-apps/plugin-dialog
export const open = async () => null;
export const save = async () => null;
export const message = async () => {};
export const ask = async () => false;
export const confirm = async () => false;

// @tauri-apps/plugin-process
export const exit = async () => {};
export const relaunch = async () => {};

// @tauri-apps/plugin-shell
export const Command = class {
  static create() {
    return {
      execute: async () => ({ code: 1, stdout: '', stderr: 'Not available in web' }),
      spawn: async () => ({}),
    };
  }
};

// @tauri-apps/plugin-updater
export const check = async () => null;

// Default export for modules that use it
export default {
  invoke,
  getCurrentWindow,
  Window,
  getCurrentWebview,
  open,
  save,
  message,
  ask,
  confirm,
  exit,
  relaunch,
  Command,
  check,
};
