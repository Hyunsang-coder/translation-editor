import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAiConfigStore } from '@/stores/aiConfigStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/shallow';
import { mcpClientManager } from '@/ai/mcp/McpClientManager';
import { initializeSecrets } from '@/tauri/secrets';
import { initializeConnectors } from '@/stores/connectorStore';
import { cleanupTempImages } from '@/tauri/attachments';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import { UpdateModal } from '@/components/ui/UpdateModal';
import { getCurrentWindow } from '@tauri-apps/api/window';

function App(): JSX.Element {
  const theme = useUIStore((s) => s.theme);
  const { initializeProject, startAutoSave, stopAutoSave } = useProjectStore(
    useShallow((s) => ({ initializeProject: s.initializeProject, startAutoSave: s.startAutoSave, stopAutoSave: s.stopAutoSave }))
  );
  const loadSecureKeys = useAiConfigStore((s) => s.loadSecureKeys);

  // 자동 업데이트
  const {
    available,
    downloading,
    progress,
    error,
    update,
    downloadAndInstall,
    cancelDownload,
    skipVersion,
    dismissUpdate,
    setManualUpdate,
  } = useAutoUpdate();
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  useEffect(() => {
    if (available && update) {
      setShowUpdateModal(true);
    }
  }, [available, update]);

  // 설정 모달에서 수동 업데이트 확인 시 custom event 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setManualUpdate(detail);
        setShowUpdateModal(true);
      }
    };
    window.addEventListener('app:update-found', handler);
    return () => window.removeEventListener('app:update-found', handler);
  }, [setManualUpdate]);

  // 테마 적용 (system 모드일 때 OS 변경도 실시간 반영)
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      if (theme === 'system') {
        root.classList.toggle('dark', mediaQuery.matches);
      } else {
        root.classList.toggle('dark', theme === 'dark');
      }
    };

    applyTheme();

    if (theme === 'system') {
      mediaQuery.addEventListener('change', applyTheme);
    }

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [theme]);

  // 초기 프로젝트 설정
  useEffect(() => {
    initializeProject();
  }, [initializeProject]);

  // SecretManager 초기화 및 보안 저장소에서 API 키 로드
  // 앱 시작 시 1회 Keychain 접근으로 마스터키 로드 후 Vault 복호화
  useEffect(() => {
    const initSecrets = async () => {
      try {
        // 1. SecretManager 초기화 (Keychain에서 마스터키 로드)
        await initializeSecrets();
        
        // 2. API 키 로드 (Vault에서 복호화된 캐시 사용)
        await loadSecureKeys();
        
        // 3. 커넥터 상태 동기화 (Vault에서 토큰 상태 확인)
        await initializeConnectors();
      } catch (error) {
        console.error('[App] Failed to initialize secrets:', error);
      }
    };
    
    void initSecrets();
  }, [loadSecureKeys]);

  // MCP 클라이언트 초기화 (저장된 토큰이 있으면 자동 연결)
  useEffect(() => {
    void mcpClientManager.initialize();
  }, []);

  // 임시 파일 정리 (24시간 이상 된 임시 이미지 삭제)
  useEffect(() => {
    cleanupTempImages()
      .then((count) => {
        if (count > 0) {
          console.warn(`[App] Cleaned up ${count} old temp images`);
        }
      })
      .catch((error) => {
        console.warn('[App] Failed to cleanup temp images:', error);
      });
  }, []);

  // Auto-save (Phase 4.2 안정화: Monaco 단일 문서 편집에서도 주기 저장)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  // Safe Exit: 저장되지 않은 변경사항이 있으면 저장하고 종료
  useEffect(() => {
    const initCloseListener = async () => {
      const appWindow = getCurrentWindow();
      let allowClose = false;
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        if (allowClose) return;
        const { isDirty, saveProject } = useProjectStore.getState();
        if (isDirty) {
          // Prevent closing immediately
          event.preventDefault();
          try {
            await saveProject();
            allowClose = true;
            await appWindow.close();
          } catch (e) {
            console.error('Failed to save on close:', e);
            const message = e instanceof Error ? e.message : 'Failed to save project before exit';
            useProjectStore.getState().setError(`저장 실패로 종료가 취소되었습니다: ${message}`);
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

      <UpdateModal
        isOpen={showUpdateModal}
        version={update?.version ?? ''}
        releaseNotes={update?.body ?? undefined}
        downloading={downloading}
        progress={progress}
        error={error}
        onUpdate={downloadAndInstall}
        onCancel={cancelDownload}
        onSkipVersion={() => {
          if (update?.version) {
            skipVersion(update.version);
          }
          setShowUpdateModal(false);
        }}
        onDismiss={() => {
          dismissUpdate();
          setShowUpdateModal(false);
        }}
      />
    </div>
  );
}

export default App;
