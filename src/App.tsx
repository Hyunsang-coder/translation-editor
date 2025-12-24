import { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';

function App(): JSX.Element {
  const { theme } = useUIStore();
  const { initializeProject, startAutoSave, stopAutoSave } = useProjectStore();
  const DEBUG_RUN_ID = 'monaco-dispose-pre-1';

  // 테마 적용
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  // Debug: Monaco DiffEditor dispose 에러를 전역에서 캡처 (모달 언마운트 이후에도 잡기 위함)
  useEffect(() => {
    const onError = (ev: ErrorEvent): void => {
      if (!ev?.message) return;
      if (!String(ev.message).includes('TextModel got disposed before DiffEditorWidget model got reset')) return;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9d61bfef-51ac-4a4b-97c4-ba7d461103d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:DEBUG_RUN_ID,hypothesisId:'H5',location:'App.tsx:window.error',message:'Caught global Monaco dispose/reset error',data:{message:String(ev.message),stack:(ev.error?.stack?String(ev.error.stack).slice(0,800):null)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    };
    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, []);

  // 초기 프로젝트 설정
  useEffect(() => {
    initializeProject();
  }, [initializeProject]);

  // Auto-save (Phase 4.2 안정화: Monaco 단일 문서 편집에서도 주기 저장)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  // Safe Exit: 저장되지 않은 변경사항이 있으면 저장하고 종료
  useEffect(() => {
    const initCloseListener = async () => {
      // Dynamic import to avoid SSR/build issues if any, though standard import is fine
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        const { isDirty, saveProject } = useProjectStore.getState();
        if (isDirty) {
          // Prevent closing immediately
          event.preventDefault();
          try {
            await saveProject();
          } catch (e) {
            console.error('Failed to save on close:', e);
          } finally {
            // Force close after save attempt
            await getCurrentWindow().destroy();
          }
        }
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    initCloseListener().then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div className="min-h-screen bg-editor-bg text-editor-text">
      <MainLayout />
    </div>
  );
}

export default App;

