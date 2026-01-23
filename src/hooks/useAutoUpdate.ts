import { useEffect, useState, useCallback, useRef } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const SKIPPED_VERSION_KEY = 'oddeyes_skipped_update_version';

interface UpdateState {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  update: Update | null;
}

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>({
    checking: false,
    available: false,
    downloading: false,
    progress: 0,
    error: null,
    update: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const checkForUpdate = useCallback(async () => {
    setState(prev => ({ ...prev, checking: true, error: null }));

    try {
      const update = await check();

      if (update) {
        // 스킵된 버전인지 확인
        const skippedVersion = localStorage.getItem(SKIPPED_VERSION_KEY);
        if (skippedVersion === update.version) {
          setState(prev => ({ ...prev, checking: false, available: false }));
          return null;
        }

        setState(prev => ({
          ...prev,
          checking: false,
          available: true,
          update,
        }));
        return update;
      } else {
        setState(prev => ({ ...prev, checking: false, available: false }));
        return null;
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        checking: false,
        error: error instanceof Error ? error.message : 'Update check failed',
      }));
      return null;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!state.update) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState(prev => ({ ...prev, downloading: true, progress: 0, error: null }));

    try {
      let contentLength = 0;
      let downloaded = 0;

      await state.update.downloadAndInstall((event) => {
        // 취소 확인
        if (controller.signal.aborted) {
          throw new Error('Download cancelled');
        }

        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            const progress = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setState(prev => ({ ...prev, progress }));
            break;
          case 'Finished':
            setState(prev => ({ ...prev, progress: 100 }));
            break;
        }
      });

      await relaunch();
    } catch (error) {
      if (controller.signal.aborted) {
        setState(prev => ({
          ...prev,
          downloading: false,
          progress: 0,
          error: null,
        }));
      } else {
        setState(prev => ({
          ...prev,
          downloading: false,
          error: error instanceof Error ? error.message : 'Update failed',
        }));
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [state.update]);

  const cancelDownload = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState(prev => ({ ...prev, downloading: false, progress: 0 }));
  }, []);

  const skipVersion = useCallback((version: string) => {
    localStorage.setItem(SKIPPED_VERSION_KEY, version);
    setState(prev => ({ ...prev, available: false, update: null }));
  }, []);

  const dismissUpdate = useCallback(() => {
    setState(prev => ({ ...prev, available: false }));
  }, []);

  // 앱 시작 시 자동 체크 (프로덕션만)
  useEffect(() => {
    if (import.meta.env.DEV) return;

    const timer = setTimeout(() => {
      checkForUpdate();
    }, 3000);

    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    cancelDownload,
    skipVersion,
    dismissUpdate,
  };
}
